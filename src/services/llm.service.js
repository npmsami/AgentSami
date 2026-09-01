const https = require('https');
const OpenAI = require('openai');
const logger = require('../core/logger').createServiceLogger('LLM');
const config = require('../core/config');
const { promptLoader } = require('../../prompt-loader');

// Shared HTTPS agent — keeps TCP+TLS connections alive across requests.
// Without this, every request pays 100-300 ms for a fresh TLS handshake.
const sharedAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 5,
  maxFreeSockets: 5,
  timeout: 60000,
});

const NATURAL_INTERVIEW_STYLE = `

## Spoken Interview Style
- Write like a candidate is speaking in a live interview, not like a blog, article, or documentation page.
- Use simple first-person phrasing when natural: "I would", "My approach is", "The way I think about it is".
- Keep the answer compact: 3-6 spoken sentences for normal questions, then add code only if the question needs code.
- Use project/scenario examples only when the question calls for it, such as experience, design, troubleshooting, tradeoff, implementation, migration, optimization, or "have you used this" questions.
- For quick factual, definition, syntax, command, or direct comparison questions, answer directly without forcing a project story.
- When resume/CV or job-description context is available, ground examples in that context instead of giving generic textbook examples.
- If no personal project context is available, use a modest, realistic engineering scenario without pretending to know exact company names, metrics, or events.
- Prefer this flow for experience questions: what the project needed, what I did, why I chose it, and what changed afterward.
- Avoid long polished paragraphs, generic introductions, and over-structured headings.
- Use bullets only when they make the answer easier to say out loud; otherwise use short conversational sentences.
- Sound confident but human. It is okay to use natural transitions like "So", "Basically", "For example", and "In practice".
- Do not mention that this is an AI-generated answer or that you are helping someone during an interview.`;

class LLMService {
  constructor() {
    this.client = null;
    this.isInitialized = false;
    this.requestCount = 0;
    this.errorCount = 0;
    this.interviewContext = { cv: '', jd: '' };

    // Cached values — refreshed on init and when the API key changes.
    this._cachedApiKey = null;
    this._cachedModel = null;
    this._cachedTimeout = null;
    this._cachedMaxRetries = null;
    this._cachedUserAgent = null;
    this._cachedGenerationConfig = null;

    this.initializeClient();
    this._refreshCache();
  }

  /** Refresh all values that are read on every request. */
  _refreshCache() {
    this._cachedApiKey = config.getApiKey('OPENAI');
    this._cachedModel = config.get('llm.openai.model');
    this._cachedTimeout = config.get('llm.openai.timeout');
    this._cachedMaxRetries = config.get('llm.openai.maxRetries');
    this._cachedGenerationConfig = null; // cleared so getGenerationConfig rebuilds once
  }

  setInterviewContext(cv, jd) {
    this.interviewContext = { cv: cv || '', jd: jd || '' };
    logger.info('Interview context updated', {
      hasCv: !!this.interviewContext.cv,
      hasJd: !!this.interviewContext.jd
    });
  }

  getInterviewContext() {
    return this.interviewContext;
  }

  buildInterviewContextBlock() {
    const ctx = this.interviewContext;
    if (!ctx || (!ctx.cv && !ctx.jd)) return '';

    let block = '\n\n## Interview Context\nUse the following information to personalize and tailor your answers to this specific candidate and role:\n\n';
    if (ctx.cv) {
      const cvSnippet = ctx.cv.length > 3000 ? ctx.cv.substring(0, 3000) + '\n[... truncated ...]' : ctx.cv;
      block += `### Candidate Resume/CV:\n${cvSnippet}\n\n`;
    }
    if (ctx.jd) {
      const jdSnippet = ctx.jd.length > 2000 ? ctx.jd.substring(0, 2000) + '\n[... truncated ...]' : ctx.jd;
      block += `### Job Description:\n${jdSnippet}\n`;
    }
    block += '\nWhen the question asks for experience, design decisions, tradeoffs, troubleshooting, or implementation, connect the answer to this candidate/role context with a concrete project-style example. For simple factual questions, answer directly without forcing a project story. Do not invent exact employers, metrics, or claims that are not supported by the context.\n';
    return block;
  }

  initializeClient() {
    const apiKey = config.getApiKey('OPENAI');
    
    if (!apiKey || apiKey === 'your-api-key-here') {
      logger.warn('OpenAI API key not configured', { 
        keyExists: !!apiKey,
        isPlaceholder: apiKey === 'your-api-key-here'
      });
      return;
    }

    try {
      this.client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
      this.isInitialized = true;
      
      logger.info('OpenAI client initialized successfully', {
        model: config.get('llm.openai.model')
      });
    } catch (error) {
      logger.error('Failed to initialize OpenAI client', { 
        error: error.message 
      });
    }
  }

  getGenerationConfig(overrides = {}) {
    // Build the base config once and cache it; reuse on every call (overrides still applied fresh).
    if (!this._cachedGenerationConfig) {
      const defaults = config.get('llm.openai.generation') || {};
      const fallback = { temperature: 0.7, max_tokens: 2048 };
      this._cachedGenerationConfig = Object.fromEntries(
        Object.entries({ ...fallback, ...defaults }).filter(([, v]) => v !== undefined && v !== null)
      );
    }

    if (!Object.keys(overrides).length) return this._cachedGenerationConfig;

    return Object.fromEntries(
      Object.entries({ ...this._cachedGenerationConfig, ...overrides }).filter(([, v]) => v !== undefined && v !== null)
    );
  }

  extractTextFromResponse(response) {
    if (!response || !response.choices || !response.choices.length) {
      throw new Error('No choices in OpenAI response');
    }

    const choice = response.choices[0];
    const text = choice.message?.content;

    if (!text || !text.trim()) {
      throw new Error(`No text content in OpenAI response. Finish reason: ${choice.finish_reason}`);
    }

    return {
      text: text.trim(),
      finishReason: choice.finish_reason || null
    };
  }

  /**
   * Process an image with OpenAI using the active skill prompt.
   * @param {Buffer} imageBuffer - PNG/JPEG image bytes
   * @param {string} mimeType - e.g., 'image/png' or 'image/jpeg'
   * @param {string} activeSkill - current skill (e.g. 'dsa')
   * @param {Array} sessionMemory - optional
   * @param {string|null} programmingLanguage - optional language context
   * @returns {Promise<{response: string, metadata: object}>}
   */
  /**
   * Stream a request to OpenAI via raw Node.js HTTPS (bypasses Electron SSL issues).
   * Parses SSE chunks and calls onChunk for each token.
   * Returns the full accumulated text when complete.
   */
  async executeStreamingRequest(openaiRequest, onChunk) {
    const apiKey = this._cachedApiKey;
    const model = this._cachedModel;
    const timeout = this._cachedTimeout;

    const requestBody = { model, ...openaiRequest, stream: true };
    const postData = JSON.stringify(requestBody);

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': this.getUserAgent(),
      },
      timeout,
      agent: sharedAgent,
    };

    logger.debug('Starting streaming request via native HTTPS');

    return new Promise((resolve, reject) => {
      const req = https.request('https://api.openai.com/v1/chat/completions', options, (res) => {
        if (res.statusCode !== 200) {
          let errData = '';
          res.on('data', chunk => { errData += chunk; });
          res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${errData}`)));
          return;
        }

        let fullText = '';
        let sseBuffer = '';

        res.on('data', (chunk) => {
          sseBuffer += chunk.toString();
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop(); // keep any incomplete line

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullText += content;
                onChunk(content);
              }
            } catch (_) {
              // incomplete JSON chunk, skip
            }
          }
        });

        res.on('end', () => {
          // flush any remaining buffer
          if (sseBuffer.startsWith('data: ')) {
            const data = sseBuffer.slice(6).trim();
            if (data && data !== '[DONE]') {
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (content) { fullText += content; onChunk(content); }
              } catch (_) {}
            }
          }
          logger.debug('Streaming request completed', { responseLength: fullText.length });
          resolve(fullText);
        });

        res.on('error', (error) => reject(new Error(`Stream response error: ${error.message}`)));
      });

      req.on('error', (error) => reject(new Error(`Streaming request failed: ${error.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Streaming request timeout')); });

      req.write(postData);
      req.end();
    });
  }

  async processImageWithSkill(imageBuffer, mimeType, activeSkill, sessionMemory = [], programmingLanguage = null, streamCallback = null) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check OpenAI API key configuration.');
    }

    if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
      throw new Error('Invalid image buffer provided to processImageWithSkill');
    }

    const startTime = Date.now();
    this.requestCount++;

    try {
      const skillPrompt = promptLoader.getSkillPrompt(activeSkill, programmingLanguage) || '';
      const base64 = imageBuffer.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64}`;

      const messages = [];

      if (skillPrompt && skillPrompt.trim().length > 0) {
        messages.push({ role: 'system', content: skillPrompt + NATURAL_INTERVIEW_STYLE });
      }

      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: this.formatImageInstruction(activeSkill, programmingLanguage) },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      });

      const openaiRequest = { messages, ...this.getGenerationConfig() };

      let responseText;
      if (streamCallback) {
        responseText = await this.executeStreamingRequest(openaiRequest, streamCallback);
      } else {
        try {
          responseText = await this.executeRequest(openaiRequest);
        } catch (error) {
          logger.warn('Primary SDK method failed, trying alternative HTTPS method', { error: error.message });
          try {
            responseText = await this.executeAlternativeRequest(openaiRequest);
          } catch (secondaryError) {
            logger.error('Both OpenAI request methods failed', {
              firstError: error.message,
              secondError: secondaryError.message
            });
            throw secondaryError;
          }
        }
      }

      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(responseText, programmingLanguage)
        : responseText;

      logger.logPerformance('LLM image processing', startTime, {
        activeSkill,
        imageSize: imageBuffer.length,
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          isImageAnalysis: true,
          mimeType
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM image processing failed', {
        error: error.message,
        activeSkill,
        requestId: this.requestCount
      });

      if (config.get('llm.openai.fallbackEnabled')) {
        return this.generateFallbackResponse('[image]', activeSkill);
      }
      throw error;
    }
  }

  formatImageInstruction(activeSkill, programmingLanguage) {
    const langNote = programmingLanguage ? ` Use only ${programmingLanguage.toUpperCase()} for any code.` : '';
    return `Analyze this image for a ${activeSkill.toUpperCase()} interview question. Give a natural spoken answer I can say out loud. Keep it short and human, then include final code only if the image contains a coding problem.${langNote}`;
  }

  async processTextWithSkill(text, activeSkill, sessionMemory = [], programmingLanguage = null, streamCallback = null) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check OpenAI API key configuration.');
    }

    const startTime = Date.now();
    this.requestCount++;
    
    try {
      logger.info('Processing text with LLM', {
        activeSkill,
        textLength: text.length,
        hasSessionMemory: sessionMemory.length > 0,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      const openaiRequest = this.buildOpenAIRequest(text, activeSkill, sessionMemory, programmingLanguage);

      let response;
      if (streamCallback) {
        response = await this.executeStreamingRequest(openaiRequest, streamCallback);
      } else {
        try {
          response = await this.executeRequest(openaiRequest);
        } catch (error) {
          logger.warn('Primary method failed, trying alternative HTTPS method', {
            error: error.message,
            requestId: this.requestCount
          });
          try {
            response = await this.executeAlternativeRequest(openaiRequest);
          } catch (secondaryError) {
            logger.error('Both OpenAI request methods failed for text processing', {
              firstError: error.message,
              secondError: secondaryError.message,
              requestId: this.requestCount
            });
            throw secondaryError;
          }
        }
      }
      
      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(response, programmingLanguage)
        : response;

      logger.logPerformance('LLM text processing', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM processing failed', {
        error: error.message,
        activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      if (config.get('llm.openai.fallbackEnabled')) {
        return this.generateFallbackResponse(text, activeSkill);
      }
      
      throw error;
    }
  }

  async processTranscriptionWithIntelligentResponse(text, activeSkill, sessionMemory = [], programmingLanguage = null, streamCallback = null) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check OpenAI API key configuration.');
    }

    const startTime = Date.now();
    this.requestCount++;
    
    try {
      logger.info('Processing transcription with intelligent response', {
        activeSkill,
        textLength: text.length,
        hasSessionMemory: sessionMemory.length > 0,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      const openaiRequest = this.buildIntelligentTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage);

      let response;
      if (streamCallback) {
        response = await this.executeStreamingRequest(openaiRequest, streamCallback);
      } else {
        try {
          response = await this.executeRequest(openaiRequest);
        } catch (error) {
          logger.warn('Primary method failed, trying alternative HTTPS method', {
            error: error.message,
            requestId: this.requestCount
          });
          try {
            response = await this.executeAlternativeRequest(openaiRequest);
          } catch (secondaryError) {
            logger.error('Both OpenAI request methods failed for transcription processing', {
              firstError: error.message,
              secondError: secondaryError.message,
              requestId: this.requestCount
            });
            throw secondaryError;
          }
        }
      }
      
      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(response, programmingLanguage)
        : response;

      logger.logPerformance('LLM transcription processing', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          isTranscriptionResponse: true
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM transcription processing failed', {
        error: error.message,
        activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      if (config.get('llm.openai.fallbackEnabled')) {
        return this.generateIntelligentFallbackResponse(text, activeSkill);
      }
      
      throw error;
    }
  }

  /**
   * Normalize all triple-backtick code fences to the selected programming language tag.
   */
  enforceProgrammingLanguage(text, programmingLanguage) {
    try {
      if (!text || !programmingLanguage) return text;
      const norm = String(programmingLanguage).toLowerCase();
      const fenceTagMap = { cpp: 'cpp', c: 'c', python: 'python', java: 'java', javascript: 'javascript', js: 'javascript' };
      const fenceTag = fenceTagMap[norm] || norm || 'text';

      const replacedBackticks = text.replace(/```([^\n]*)\n/g, (match, info) => {
        const current = (info || '').trim();
        if (current.split(/\s+/)[0].toLowerCase() === fenceTag) return match;
        return '```' + fenceTag + '\n';
      });

      const normalizedTildes = replacedBackticks.replace(/~~~([^\n]*)\n/g, () => '```' + fenceTag + '\n');

      return normalizedTildes;
    } catch (_) {
      return text;
    }
  }

  buildOpenAIRequest(text, activeSkill, sessionMemory, programmingLanguage) {
    const sessionManager = require('../managers/session.manager');
    
    if (sessionManager && typeof sessionManager.getConversationHistory === 'function') {
      const conversationHistory = sessionManager.getConversationHistory(15);
      const skillContext = sessionManager.getSkillContext(activeSkill, programmingLanguage);
      return this.buildOpenAIRequestWithHistory(text, activeSkill, conversationHistory, skillContext, programmingLanguage);
    }

    const requestComponents = promptLoader.getRequestComponents(
      activeSkill, 
      text, 
      sessionMemory,
      programmingLanguage
    );

    const messages = [];

    if (requestComponents.shouldUseModelMemory && requestComponents.skillPrompt) {
      messages.push({ role: 'system', content: requestComponents.skillPrompt });
      
      logger.debug('Using language-enhanced system instruction for skill', {
        skill: activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        promptLength: requestComponents.skillPrompt.length
      });
    }

    messages.push({ role: 'user', content: this.formatUserMessage(text, activeSkill) });

    return { messages, ...this.getGenerationConfig() };
  }

  buildOpenAIRequestWithHistory(text, activeSkill, conversationHistory, skillContext, programmingLanguage) {
    const messages = [];

    if (skillContext.skillPrompt) {
      const systemContent = skillContext.skillPrompt + NATURAL_INTERVIEW_STYLE + this.buildInterviewContextBlock();
      messages.push({ role: 'system', content: systemContent });
      
      logger.debug('Using skill context prompt as system message', {
        skill: activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        promptLength: systemContent.length,
        hasInterviewContext: !!(this.interviewContext.cv || this.interviewContext.jd)
      });
    }

    conversationHistory
      .filter(event => {
        return event.role !== 'system' &&
               event.content &&
               typeof event.content === 'string' &&
               event.content.trim().length > 0 &&
               // Only carry history from the same skill, so a previous skill's
               // answers (e.g. DevOps) never bleed into a different skill's turn.
               (!event.skill || event.skill === activeSkill);
      })
      .forEach(event => {
        const role = event.role === 'model' ? 'assistant' : 'user';
        messages.push({ role, content: event.content.trim() });
      });

    const formattedMessage = this.formatUserMessage(text, activeSkill);
    if (!formattedMessage || formattedMessage.trim().length === 0) {
      throw new Error('Failed to format user message or message is empty');
    }

    messages.push({ role: 'user', content: formattedMessage });

    logger.debug('Built OpenAI request with conversation history', {
      skill: activeSkill,
      programmingLanguage: programmingLanguage || 'not specified',
      historyLength: conversationHistory.length,
      totalMessages: messages.length
    });

    return { messages, ...this.getGenerationConfig() };
  }

  buildIntelligentTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage) {
    const cleanText = text && typeof text === 'string' ? text.trim() : '';
    if (!cleanText) {
      throw new Error('Empty or invalid transcription text provided to buildIntelligentTranscriptionRequest');
    }

    const sessionManager = require('../managers/session.manager');
    
    if (sessionManager && typeof sessionManager.getConversationHistory === 'function') {
      const conversationHistory = sessionManager.getConversationHistory(10);
      const skillContext = sessionManager.getSkillContext(activeSkill, programmingLanguage);
      return this.buildIntelligentTranscriptionRequestWithHistory(cleanText, activeSkill, conversationHistory, skillContext, programmingLanguage);
    }

    const intelligentPrompt = this.getIntelligentTranscriptionPrompt(activeSkill, programmingLanguage);
    if (!intelligentPrompt) {
      throw new Error('Failed to generate intelligent transcription prompt');
    }

    return {
      messages: [
        { role: 'system', content: intelligentPrompt },
        { role: 'user', content: cleanText }
      ],
      ...this.getGenerationConfig()
    };
  }

  buildIntelligentTranscriptionRequestWithHistory(text, activeSkill, conversationHistory, skillContext, programmingLanguage) {
    const intelligentPrompt = this.getIntelligentTranscriptionPrompt(activeSkill, programmingLanguage);

    const messages = [{ role: 'system', content: intelligentPrompt }];

    conversationHistory
      .filter(event => {
        return event.role !== 'system' &&
               event.content &&
               typeof event.content === 'string' &&
               event.content.trim().length > 0 &&
               // Same-skill history only — don't let another skill's answers leak in.
               (!event.skill || event.skill === activeSkill);
      })
      .slice(-8)
      .forEach(event => {
        const content = event.content.trim();
        if (!content) return;
        const role = event.role === 'model' ? 'assistant' : 'user';
        messages.push({ role, content });
      });

    const cleanText = text && typeof text === 'string' ? text.trim() : '';
    if (!cleanText) {
      throw new Error('Empty or invalid transcription text provided');
    }

    messages.push({ role: 'user', content: cleanText });

    if (messages.length <= 1) {
      throw new Error('No valid content to send to OpenAI API');
    }

    logger.debug('Built intelligent transcription request with conversation history', {
      skill: activeSkill,
      programmingLanguage: programmingLanguage || 'not specified',
      historyLength: conversationHistory.length,
      totalMessages: messages.length,
      cleanTextLength: cleanText.length
    });

    return { messages, ...this.getGenerationConfig() };
  }

  getIntelligentTranscriptionPrompt(activeSkill, programmingLanguage) {
    // Load the authoritative persona for the active skill so the live-transcription
    // path uses the SAME identity/terminology rules as the typed-chat path.
    // Without this the model had no skill context and would drift across domains
    // (e.g. answering an AI Engineer "MCP" question as cloud/DevOps).
    const skillPersona = promptLoader.getSkillPrompt(activeSkill, programmingLanguage) || '';

    let prompt = '';
    if (skillPersona) {
      prompt += `${skillPersona}\n\n---\n\n`;
    }

    prompt += `You are an expert interview assistant helping a candidate during a live interview.
Your role is fixed: **${activeSkill.toUpperCase()}**. Stay in that persona and its terminology for every answer — do not re-interpret domain-specific acronyms or concepts as belonging to another field, and do not switch to a different engineering role's framing or project stories.
If the interviewer asks something genuinely outside the role (e.g. a behavioural or general system-design question), answer it briefly and plainly, then return to the role's perspective. Never invent a plausible-sounding definition for a term you don't recognise — say you're not sure what they mean and ask them to clarify.

## Core Rules
- Answer EVERY question fully and directly — never refuse, but keep the role's persona.
- Be concise but complete. Give an answer the candidate can say naturally out loud.
- Prefer short conversational sentences over polished paragraphs.
- Avoid sounding like a blog post, documentation page, or memorized script.
- Use first-person phrasing where it sounds natural, like "I would start by..." or "The main tradeoff I see is...".
- First classify the question. Use a project/scenario example only when it helps: experience, design, troubleshooting, tradeoff, implementation, migration, optimization, or "have you used this" questions.
- For quick factual, definition, syntax, command, or direct comparison questions, answer directly and do not force a project story.
- If resume/CV or job-description context is available, use that as the source of project examples. If not, keep the example realistic and modest without inventing exact company names or metrics.
- Do not overuse bullet points. Use them only for lists or tradeoffs.
- Do not repeat the question back to the user.
- For follow-up or clarification questions, stay in context of the previous answer.`;

    if (programmingLanguage) {
      const lang = String(programmingLanguage).toLowerCase();
      const languageMap = { cpp: 'C++', c: 'C', python: 'Python', java: 'Java', javascript: 'JavaScript', js: 'JavaScript' };
      const fenceTagMap = { cpp: 'cpp', c: 'c', python: 'python', java: 'java', javascript: 'javascript', js: 'javascript' };
      const languageTitle = languageMap[lang] || (lang.charAt(0).toUpperCase() + lang.slice(1));
      const fenceTag = fenceTagMap[lang] || lang || 'text';
      prompt += `\n\n## Coding Language\nWhen writing code, use ${languageTitle} only. All code blocks must use triple backticks with tag \`\`\`${fenceTag}\`\`\`.`;
    }

    prompt += `

## Response Format
- **Technical / concept questions**: short direct answer. Add a project-style example only if the question sounds experience-based or scenario-based.
- **Coding / algorithm problems**: approach → clean implementation in a properly tagged code block → time & space complexity.
- **Behavioural / situational questions**: natural STAR-style answer in 4-6 sentences, focused on a real project scenario, without labeling every section unless asked.
- **Casual / filler speech** (e.g. "um", "okay", "let me think"): respond with a single short encouraging phrase like "Take your time." or "Go ahead."`;

    prompt += this.buildInterviewContextBlock();

    return prompt;
  }

  formatUserMessage(text, activeSkill) {
    return text;
  }

  async executeRequest(openaiRequest) {
    const maxRetries = this._cachedMaxRetries;
    const timeout = this._cachedTimeout;
    const model = this._cachedModel;

    logger.debug('Executing OpenAI request', {
      hasClient: !!this.client,
      model,
      timeout,
      maxRetries,
    });
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug(`OpenAI API attempt ${attempt} starting`, {
          timestamp: new Date().toISOString(),
          timeout
        });

        // Use native HTTPS directly — Electron's Chromium fetch has SSL issues
        const text = await this.executeAlternativeRequest(openaiRequest);

        logger.debug('OpenAI API request successful', {
          attempt,
          responseLength: text.length
        });

        return text;
      } catch (error) {
        const errorInfo = this.analyzeError(error);
        
        logger.warn(`OpenAI API attempt ${attempt} failed`, {
          error: error.message,
          errorType: errorInfo.type,
          isNetworkError: errorInfo.isNetworkError,
          suggestedAction: errorInfo.suggestedAction,
          remainingAttempts: maxRetries - attempt
        });

        if (attempt === maxRetries) {
          const finalError = new Error(`OpenAI API failed after ${maxRetries} attempts: ${error.message}`);
          finalError.errorAnalysis = errorInfo;
          finalError.originalError = error;
          throw finalError;
        }

        const baseDelay = errorInfo.isNetworkError ? 2500 : 1500;
        const delay = baseDelay * attempt + Math.random() * 1000;
        
        logger.debug(`Waiting ${delay}ms before retry ${attempt + 1}`);
        await this.delay(delay);
      }
    }
  }

  async performPreflightCheck() {
    try {
      const startTime = Date.now();
      await this.testNetworkConnection({ 
        host: 'api.openai.com', 
        port: 443, 
        name: 'OpenAI API Endpoint' 
      });
      logger.debug('Preflight check passed', { latency: Date.now() - startTime });
    } catch (error) {
      logger.warn('Preflight check failed', { 
        error: error.message,
        suggestion: 'Network connectivity issue detected before API call'
      });
    }
  }

  getUserAgent() {
    if (this._cachedUserAgent) return this._cachedUserAgent;
    try {
      this._cachedUserAgent = (typeof navigator !== 'undefined' && navigator.userAgent)
        ? navigator.userAgent
        : `Node.js/${process.version} (${process.platform}; ${process.arch})`;
    } catch {
      this._cachedUserAgent = 'Unknown';
    }
    return this._cachedUserAgent;
  }

  analyzeError(error) {
    const errorMessage = error.message.toLowerCase();
    
    if (errorMessage.includes('fetch failed') || 
        errorMessage.includes('network error') ||
        errorMessage.includes('enotfound') ||
        errorMessage.includes('econnrefused') ||
        errorMessage.includes('timeout')) {
      return {
        type: 'NETWORK_ERROR',
        isNetworkError: true,
        suggestedAction: 'Check internet connection and firewall settings'
      };
    }
    
    if (errorMessage.includes('unauthorized') || 
        errorMessage.includes('invalid api key') ||
        errorMessage.includes('incorrect api key') ||
        errorMessage.includes('forbidden')) {
      return {
        type: 'AUTH_ERROR',
        isNetworkError: false,
        suggestedAction: 'Verify OpenAI API key configuration'
      };
    }
    
    if (errorMessage.includes('quota') || 
        errorMessage.includes('rate limit') ||
        errorMessage.includes('too many requests') ||
        errorMessage.includes('429')) {
      return {
        type: 'RATE_LIMIT_ERROR',
        isNetworkError: false,
        suggestedAction: 'Wait before retrying or check API quota'
      };
    }
    
    if (errorMessage.includes('request timeout') || errorMessage.includes('etimedout')) {
      return {
        type: 'TIMEOUT_ERROR',
        isNetworkError: true,
        suggestedAction: 'Check network latency or increase timeout'
      };
    }
    
    return {
      type: 'UNKNOWN_ERROR',
      isNetworkError: false,
      suggestedAction: 'Check logs for more details'
    };
  }

  async checkNetworkConnectivity() {
    const connectivityTests = [
      { host: 'google.com', port: 443, name: 'Google (HTTPS)' },
      { host: 'api.openai.com', port: 443, name: 'OpenAI API Endpoint' }
    ];

    const results = await Promise.allSettled(
      connectivityTests.map(test => this.testNetworkConnection(test))
    );

    const connectivity = {
      timestamp: new Date().toISOString(),
      tests: results.map((result, index) => ({
        ...connectivityTests[index],
        success: result.status === 'fulfilled' && result.value,
        error: result.status === 'rejected' ? result.reason.message : null
      }))
    };

    logger.info('Network connectivity check completed', connectivity);
    return connectivity;
  }

  async testNetworkConnection({ host, port, name }) {
    return new Promise((resolve, reject) => {
      const net = require('net');
      const socket = new net.Socket();
      
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection timeout to ${host}:${port}`));
      }, 5000);

      socket.on('connect', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });

      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Connection failed to ${host}:${port}: ${error.message}`));
      });

      socket.connect(port, host);
    });
  }

  generateFallbackResponse(text, activeSkill) {
    logger.info('Generating fallback response', { activeSkill });

    const fallbackResponses = {
      'dsa': 'This appears to be a data structures and algorithms problem. Consider breaking it down into smaller components and identifying the appropriate algorithm or data structure to use.',
      'system-design': 'For this system design question, consider scalability, reliability, and the trade-offs between different architectural approaches.',
      'programming': 'This looks like a programming challenge. Focus on understanding the requirements, edge cases, and optimal time/space complexity.',
      'default': 'I can help analyze this content. Please ensure your OpenAI API key is properly configured for detailed analysis.'
    };

    const response = fallbackResponses[activeSkill] || fallbackResponses.default;
    
    return {
      response,
      metadata: {
        skill: activeSkill,
        processingTime: 0,
        requestId: this.requestCount,
        usedFallback: true
      }
    };
  }

  generateIntelligentFallbackResponse(text, activeSkill) {
    logger.info('Generating intelligent fallback response for transcription', { activeSkill });

    const skillKeywords = {
      'dsa': ['algorithm', 'data structure', 'array', 'tree', 'graph', 'sort', 'search', 'complexity', 'big o'],
      'programming': ['code', 'function', 'variable', 'class', 'method', 'bug', 'debug', 'syntax'],
      'system-design': ['scalability', 'database', 'architecture', 'microservice', 'load balancer', 'cache'],
      'behavioral': ['interview', 'experience', 'situation', 'leadership', 'conflict', 'team'],
      'sales': ['customer', 'deal', 'negotiation', 'price', 'revenue', 'prospect'],
      'presentation': ['slide', 'audience', 'public speaking', 'presentation', 'nervous'],
      'data-science': ['data', 'model', 'machine learning', 'statistics', 'analytics', 'python', 'pandas'],
      'devops': ['deployment', 'ci/cd', 'docker', 'kubernetes', 'infrastructure', 'monitoring'],
      'ai-specialist': ['rag', 'retrieval', 'embedding', 'vector', 'mcp', 'model context protocol', 'agent', 'llm', 'prompt', 'fine-tune', 'python', 'langchain', 'langgraph', 'eval', 'reranker', 'chunk', 'context window'],
      'microsoft-dynamics': ['dynamics', 'd365', 'dataverse', 'power platform', 'power apps', 'power automate', 'plugin', 'plug-in', 'model-driven', 'canvas app', 'fetchxml', 'web api', 'business unit', 'security role', 'solution', 'managed solution', 'pcf', 'x++', 'finance and operations', 'business central', 'crm'],
      'negotiation': ['negotiate', 'compromise', 'agreement', 'terms', 'conflict resolution']
    };

    const textLower = text.toLowerCase();
    const relevantKeywords = skillKeywords[activeSkill] || [];
    const hasRelevantKeywords = relevantKeywords.some(keyword => textLower.includes(keyword));
    
    const questionIndicators = ['how', 'what', 'why', 'when', 'where', 'can you', 'could you', 'should i', '?'];
    const seemsLikeQuestion = questionIndicators.some(indicator => textLower.includes(indicator));

    let response;
    if (hasRelevantKeywords || seemsLikeQuestion) {
      response = `I'm having trouble processing that right now, but it sounds like a ${activeSkill} question. Could you rephrase or ask more specifically about what you need help with?`;
    } else {
      response = `Yeah, I'm listening. Ask your question relevant to ${activeSkill}.`;
    }
    
    return {
      response,
      metadata: {
        skill: activeSkill,
        processingTime: 0,
        requestId: this.requestCount,
        usedFallback: true,
        isTranscriptionResponse: true
      }
    };
  }

  async testConnection() {
    if (!this.isInitialized) {
      return { success: false, error: 'Service not initialized' };
    }

    try {
      const networkCheck = await this.checkNetworkConnectivity();
      const hasNetworkIssues = networkCheck.tests.some(test => !test.success);
      
      if (hasNetworkIssues) {
        logger.warn('Network connectivity issues detected', networkCheck);
      }

      const testRequest = {
        messages: [{ role: 'user', content: 'Test connection. Please respond with "OK".' }],
        temperature: 0,
        max_tokens: 10
      };

      const startTime = Date.now();
      const text = await this.executeRequest(testRequest);
      const latency = Date.now() - startTime;
      
      logger.info('Connection test successful', { 
        response: text, 
        latency,
        networkCheck: hasNetworkIssues ? 'issues_detected' : 'healthy'
      });
      
      return { 
        success: true, 
        response: text,
        latency,
        networkConnectivity: networkCheck
      };
    } catch (error) {
      const errorAnalysis = this.analyzeError(error);
      logger.error('Connection test failed', { 
        error: error.message,
        errorAnalysis
      });
      
      return { 
        success: false, 
        error: error.message,
        errorAnalysis,
        networkConnectivity: await this.checkNetworkConnectivity().catch(() => null)
      };
    }
  }

  updateApiKey(newApiKey) {
    process.env.OPENAI_API_KEY = newApiKey;
    this.isInitialized = false;
    this.initializeClient();
    this._refreshCache();
    logger.info('OpenAI API key updated and client reinitialized');
  }

  getStats() {
    return {
      isInitialized: this.isInitialized,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      successRate: this.requestCount > 0 ? ((this.requestCount - this.errorCount) / this.requestCount) * 100 : 0,
      config: config.get('llm.openai')
    };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async executeAlternativeRequest(openaiRequest) {
    const apiKey = this._cachedApiKey;
    const model = this._cachedModel;

    const requestBody = { model, ...openaiRequest };
    const postData = JSON.stringify(requestBody);

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': this.getUserAgent(),
      },
      timeout: this._cachedTimeout,
      agent: sharedAgent,
    };

    return new Promise((resolve, reject) => {
      const req = https.request('https://api.openai.com/v1/chat/completions', options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
              return;
            }
            
            const response = JSON.parse(data);
            const { text, finishReason } = this.extractTextFromResponse(response);

            if (finishReason === 'length') {
              logger.warn('OpenAI alternative response reached max tokens limit', { finishReason });
            }
            
            logger.debug('Alternative request successful', {
              responseLength: text.length,
              statusCode: res.statusCode,
              finishReason,
            });
            
            resolve(text.trim());
          } catch (parseError) {
            logger.error('Failed to parse alternative response', {
              error: parseError.message,
              rawResponse: data.substring(0, 500),
              statusCode: res.statusCode
            });
            reject(new Error(`Failed to parse response: ${parseError.message}`));
          }
        });
      });
      
      req.on('error', (error) => {
        reject(new Error(`Alternative request failed: ${error.message}`));
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Alternative request timeout'));
      });
      
      req.write(postData);
      req.end();
    });
  }
}

module.exports = new LLMService();
