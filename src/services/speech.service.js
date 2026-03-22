const speech = require('@google-cloud/speech');
const { EventEmitter } = require('events');
const fs = require('fs');
const logger = require('../core/logger').createServiceLogger('SPEECH');
const config = require('../core/config');

const STREAM_RESTART_INTERVAL_MS = 4 * 60 * 1000; // Google streaming limit is 5 min; restart at 4

class SpeechService extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.isRecording = false;
    this.recognizeStream = null;
    this.sessionStartTime = null;
    this.available = false;
    this.streamRestartTimer = null;
    this.sampleRate = 16000; // updated by renderer before first audio chunk

    this.initializeClient();
  }

  initializeClient() {
    const rawPath = process.env.GOOGLE_SPEECH_KEY_FILE;

    if (!rawPath) {
      logger.warn('GOOGLE_SPEECH_KEY_FILE not configured. Speech recognition disabled.');
      this.available = false;
      this.emit('status', 'Speech recognition disabled (no credentials)');
      return;
    }

    // Resolve relative paths from the project root (where main.js lives)
    const path = require('path');
    const keyFilePath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(process.cwd(), rawPath);

    if (!fs.existsSync(keyFilePath)) {
      logger.error('Google Speech key file not found', { path: keyFilePath });
      this.available = false;
      this.emit('status', 'Speech key file not found');
      return;
    }

    try {
      this.client = new speech.SpeechClient({ keyFilename: keyFilePath });
      this.available = true;
      logger.info('Google Speech service initialized successfully', { keyFile: keyFilePath });
      this.emit('status', 'Google Speech ready');
    } catch (error) {
      logger.error('Failed to initialize Google Speech client', { error: error.message });
      this.available = false;
      this.emit('status', 'Speech recognition unavailable');
    }
  }

  startRecording() {
    if (!this.client) {
      this.emit('error', 'Google Speech client not initialized. Check GOOGLE_SPEECH_KEY_FILE in .env');
      return;
    }

    if (this.isRecording) {
      logger.warn('Recording already in progress');
      return;
    }

    this.isRecording = true;
    this.sessionStartTime = Date.now();
    this.emit('recording-started');

    this._startStream();

    // Auto-restart stream before Google's 5-minute limit
    this.streamRestartTimer = setInterval(() => {
      if (this.isRecording) {
        logger.info('Restarting speech stream to avoid Google 5-min limit');
        this._restartStream();
      }
    }, STREAM_RESTART_INTERVAL_MS);
  }

  _startStream() {
    const language = config.get('speech.google.language') || 'en-US';

    const request = {
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: this.sampleRate,
        languageCode: language,
        enableAutomaticPunctuation: true,
        model: 'latest_long',
      },
      interimResults: true,
    };

    try {
      this.recognizeStream = this.client
        .streamingRecognize(request)
        .on('error', (error) => {
          const message = error?.message || String(error);
          const code = error?.code;

          // If we've already stopped recording or the stream is gone, ignore late errors
          if (!this.isRecording || !this.recognizeStream) {
            logger.warn('Streaming recognition error after stop - ignoring', { message, code });
            return;
          }

          logger.error('Streaming recognition error', { error: message, code });

          // These are transient errors — restart the stream transparently so the
          // user doesn't have to press Alt+R again.
          if (
            message.includes('ECONNRESET') ||
            message.includes('write after end') ||
            message.includes('stream was destroyed') ||
            code === 11 ||
            message.includes('exceeded maximum') ||
            code === 14 // UNAVAILABLE
          ) {
            logger.info('Transient stream error — restarting stream transparently', { message, code });
            this._restartStream();
            return;
          }

          // For other real errors, surface them to the UI
          this.emit('error', `Speech error: ${message}`);
        })
        .on('data', (data) => {
          const result = data.results?.[0];
          if (!result) return;
          const transcript = result.alternatives?.[0]?.transcript?.trim() || '';
          if (!transcript) return;

          if (result.isFinal) {
            logger.info('Final transcription received', { text: transcript });
            this.emit('transcription', transcript);
          } else {
            this.emit('interim-transcription', transcript);
          }
        });

      // Signal the renderer process to start mic capture via Web Audio API
      this.emit('start-mic-capture');

      logger.info('Google Speech streaming recognition started — waiting for audio from renderer', { language });
    } catch (error) {
      logger.error('Failed to start speech stream', { error: error.message });
      this.emit('error', `Failed to start speech stream: ${error.message}`);
      this.isRecording = false;
    }
  }

  // Called by main.js when renderer reports the actual AudioContext sample rate.
  // Restarts the Google Speech stream with the correct rate before audio flows.
  restartStreamWithSampleRate(rate) {
    this.sampleRate = rate || this.sampleRate;
    logger.info('Restarting Google Speech stream with renderer sample rate', { rate: this.sampleRate });
    if (this.recognizeStream) {
      // Remove listeners BEFORE destroying to avoid the error handler firing as a false alarm
      this.recognizeStream.removeAllListeners();
      try { this.recognizeStream.destroy(); } catch (_) {}
      this.recognizeStream = null;
    }
    if (this.isRecording) {
      this._startStream();
    }
  }

  // Called by main.js with audio chunks from the renderer's Web Audio API capture
  feedAudioChunk(chunk) {
    // If we are not actively recording or the stream is gone, drop the chunk
    if (!this.isRecording || !this.recognizeStream) {
      return;
    }
    try {
      this.recognizeStream.write(chunk);
    } catch (error) {
      logger.warn('Failed to write audio chunk to recognizeStream', { error: error.message });
    }
  }

  _restartStream() {
    if (this.recognizeStream) {
      this.recognizeStream.removeAllListeners();
      try { this.recognizeStream.destroy(); } catch (_) {}
      this.recognizeStream = null;
    }
    if (this.isRecording) {
      // Tell the renderer to stop mic capture so no stale audio chunks arrive
      // during the restart gap, then _startStream will re-emit start-mic-capture.
      this.emit('stop-mic-capture');
      setTimeout(() => {
        if (this.isRecording) this._startStream();
      }, 500);
    }
  }

  stopRecording() {
    if (!this.isRecording) return;

    this.isRecording = false;
    const sessionDuration = this.sessionStartTime ? Date.now() - this.sessionStartTime : 0;

    if (this.streamRestartTimer) {
      clearInterval(this.streamRestartTimer);
      this.streamRestartTimer = null;
    }

    if (this.recognizeStream) {
      this.recognizeStream.removeAllListeners();
      try { this.recognizeStream.end(); } catch (_) {}
      this.recognizeStream = null;
    }

    logger.info('Speech recognition stopped', { sessionDuration: `${sessionDuration}ms` });
    this.emit('recording-stopped');
    this.emit('status', 'Recording stopped');

    if (global.windowManager) {
      global.windowManager.handleRecordingStopped();
    }
  }

  isAvailable() {
    return this.available && !!this.client;
  }

  getStatus() {
    return {
      isRecording: this.isRecording,
      isInitialized: !!this.client,
      sessionDuration: this.sessionStartTime ? Date.now() - this.sessionStartTime : 0,
      config: config.get('speech.google') || {},
    };
  }

  updateKeyFile(keyFilePath) {
    process.env.GOOGLE_SPEECH_KEY_FILE = keyFilePath;
    this.available = false;
    this.client = null;
    this.initializeClient();
    logger.info('Google Speech key file updated');
  }
}

module.exports = new SpeechService();
