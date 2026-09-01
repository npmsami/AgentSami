// Simple logger for renderer process
const logger = {
    info: (...args) => console.log('[MainWindowUI]', ...args),
    debug: (...args) => console.log('[MainWindowUI DEBUG]', ...args),
    error: (...args) => console.error('[MainWindowUI ERROR]', ...args),
    warn: (...args) => console.warn('[MainWindowUI WARN]', ...args)
};

class MainWindowUI {
    constructor() {
        this.isInteractive = false;
        this.isHidden = false;
        this.currentSkill = 'cloud-engineering'; // Default, will be updated from settings
        this.statusDot = null;
        this.skillIndicator = null;
        this.micButton = null;
        this.isRecording = false;
        this.speechAvailable = false;
        this._audioSource = 'mic'; // 'mic' or 'system'
        this._popoverHideTimeout = null;
        this._userScrolledUp = false;
        
        // Define available skills for navigation
        this.availableSkills = [
            'cloud-engineering',
            'sre',
            'platform-engineering',
            'infrastructure-engineering',
            'devops-engineering',
            'devsecops-engineering',
            'cicd-engineering',
            'release-engineering',
            'build-engineering',
            'automation-engineering',
            'iac-engineering',
            'kubernetes-engineering',
            'observability-engineering',
            'monitoring-engineering',
            'cloud-security-engineering',
            'systems-engineering',
            'network-engineering',
            'performance-engineering',
            'reliability-engineering',
            'operations-engineering',
            'ai-specialist',
            'backend-engineering',
            'microsoft-dynamics',
        ];
        
        this.init();
    }

    async init() {
        try {
            this.setupElements();
            this.setupEventListeners();
            
            // Load current skill from settings
            await this.loadCurrentSkill();
            
            // Load current interaction state
            await this.loadCurrentInteractionState();
            
            // Fetch speech availability
            await this.loadSpeechAvailability();
            
            this.updateSkillIndicator();
            this.updateAllElementStates(); // Update all elements with current state
            this.resizeWindowToContent();
            
            logger.info('Main window UI initialized', {
                component: 'MainWindowUI',
                skill: this.currentSkill,
                interactive: this.isInteractive
            });
            
        } catch (error) {
            logger.error('Failed to initialize main window UI', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    async loadCurrentSkill() {
        try {
            if (window.electronAPI && window.electronAPI.getSettings) {
                const settings = await window.electronAPI.getSettings();
                if (settings && settings.activeSkill) {
                    this.currentSkill = settings.activeSkill;
                    logger.debug('Loaded current skill from settings', {
                        component: 'MainWindowUI',
                        skill: this.currentSkill
                    });
                }
            }
        } catch (error) {
            logger.warn('Failed to load current skill from settings', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    async loadCurrentInteractionState() {
        try {
            // Request current interaction state from main process
            if (window.electronAPI && window.electronAPI.getWindowStats) {
                const stats = await window.electronAPI.getWindowStats();
                if (stats && typeof stats.isInteractive === 'boolean') {
                    this.isInteractive = stats.isInteractive;
                    logger.debug('Loaded current interaction state', {
                        component: 'MainWindowUI',
                        interactive: this.isInteractive
                    });
                }
            }
        } catch (error) {
            // If we can't get the state, assume non-interactive (safer default)
            this.isInteractive = false;
            logger.warn('Failed to load current interaction state, defaulting to non-interactive', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    async loadSpeechAvailability() {
        try {
            if (window.electronAPI && window.electronAPI.getSpeechAvailability) {
                this.speechAvailable = await window.electronAPI.getSpeechAvailability();
                this.applyMicVisibility();
            }
        } catch (e) {
            this.speechAvailable = false;
            this.applyMicVisibility();
        }
    }

    applyMicVisibility() {
        if (this.micButton) {
            if (this.speechAvailable) {
                this.micButton.style.display = '';
            } else {
                this.micButton.style.display = 'none';
            }
            // Resize to reflect layout change
            setTimeout(() => this.resizeWindowToContent(), 50);
        }
    }

    updateAllElementStates() {
        // Update all interactive elements with current state
        this.updateStatusDot();
        this.updateSkillIndicatorState();
        this.updateMicButtonState();
        this.updateSettingsIndicatorState();
        if (this.interviewPrepBtn) {
            this.interviewPrepBtn.disabled = !this.isInteractive;
            this.interviewPrepBtn.style.opacity = this.isInteractive ? '' : '0.5';
        }
    }

    updateStatusDot() {
        if (this.statusDot) {
            logger.debug('Updating status dot', {
                component: 'MainWindowUI',
                isInteractive: this.isInteractive,
                currentClasses: this.statusDot.className
            });
            
            // Remove both classes first
            this.statusDot.classList.remove('interactive', 'non-interactive');
            
            // Add the appropriate class
            if (this.isInteractive) {
                this.statusDot.classList.add('interactive');
            } else {
                this.statusDot.classList.add('non-interactive');
            }

            // Update the status label text in the new panel design
            const statusLabel = document.getElementById('statusLabel');
            if (statusLabel) statusLabel.textContent = this.isInteractive ? 'On' : 'Off';
            
            logger.debug('Status dot updated', {
                component: 'MainWindowUI',
                interactive: this.isInteractive,
                newClasses: this.statusDot.className
            });
        } else {
            logger.error('Status dot element not found');
        }
    }

    updateSkillIndicatorState() {
        if (this.skillIndicator) {
            // Remove both classes first
            this.skillIndicator.classList.remove('interactive', 'non-interactive');
            
            // Add the appropriate class
            if (this.isInteractive) {
                this.skillIndicator.classList.add('interactive');
            } else {
                this.skillIndicator.classList.add('non-interactive');
            }
            
            logger.debug('Skill indicator state updated', {
                component: 'MainWindowUI',
                interactive: this.isInteractive,
                classes: this.skillIndicator.className
            });
        }
    }

    updateMicButtonState() {
        if (this.micButton) {
            // Also hide when unavailable
            this.applyMicVisibility();
            // Remove both classes first
            this.micButton.classList.remove('interactive', 'non-interactive');
            
            // Add the appropriate class
            if (this.isInteractive) {
                this.micButton.classList.add('interactive');
            } else {
                this.micButton.classList.add('non-interactive');
            }
            
            // Update button state
            this.micButton.disabled = !this.isInteractive;
            
            logger.debug('Mic button state updated', {
                component: 'MainWindowUI',
                interactive: this.isInteractive,
                disabled: !this.isInteractive
            });
        }
    }

    updateSettingsIndicatorState() {
        if (this.settingsIndicator) {
            // Remove both classes first
            this.settingsIndicator.classList.remove('interactive', 'non-interactive');
            
            // Add the appropriate class
            if (this.isInteractive) {
                this.settingsIndicator.classList.add('interactive');
            } else {
                this.settingsIndicator.classList.add('non-interactive');
            }
            
            logger.debug('Settings indicator state updated', {
                component: 'MainWindowUI',
                interactive: this.isInteractive
            });
        } else {
            logger.debug('Settings indicator not found, skipping state update');
        }
    }

    resizeWindowToContent() {
        setTimeout(() => {
            if (!window.electronAPI || !window.electronAPI.resizeWindow) return;

            const panel = document.querySelector('.panel');
            const chatPanel = document.getElementById('chatPanel');

            if (!panel) return;

            const panelW = panel.scrollWidth || panel.offsetWidth;
            const panelH = panel.scrollHeight || panel.offsetHeight;

            let totalW = panelW;
            let totalH = panelH;

            if (chatPanel) {
                const chatW = chatPanel.offsetWidth;
                // Use offsetHeight (the CSS-clamped rendered height) NOT scrollHeight.
                // scrollHeight ignores max-height and would make the window grow forever,
                // preventing #inlineMsgs from ever needing its own internal scroll.
                const chatH = chatPanel.offsetHeight;
                totalW = panelW + 8 + chatW; // 8px gap
                totalH = Math.max(panelH, chatH);
            }

            logger.debug('Resizing window to content', { totalW, totalH, component: 'MainWindowUI' });
            window.electronAPI.resizeWindow(Math.ceil(totalW), Math.ceil(totalH));
        }, 100);
    }

    setupElements() {
        this.statusDot = document.getElementById('statusDot');
        this.skillIndicator = document.getElementById('skillIndicator');
        this.settingsIndicator = document.getElementById('settingsIndicator'); // Optional
        this.micButton = document.getElementById('micButton');
        this.infoButton = document.getElementById('infoButton');
        this.shortcutsPopover = document.getElementById('shortcutsPopover');
        this.interviewPrepBtn = document.getElementById('interviewPrepBtn');

        this.screenshotButton = document.getElementById('screenshotButton');

    if (!this.statusDot || !this.skillIndicator || !this.micButton || !this.screenshotButton) {
            throw new Error('Required UI elements not found');
        }

        // Screenshot click handler
        this.screenshotButton.addEventListener('click', () => {
            if (this.isInteractive && window.electronAPI && window.electronAPI.takeScreenshot) {
                window.electronAPI.takeScreenshot();
            }
        });

        // Skill indicator click handler cycles to next skill
        this.skillIndicator.addEventListener('click', () => {
            const currentIndex = this.availableSkills.indexOf(this.currentSkill);
            const nextIndex = (currentIndex + 1) % this.availableSkills.length;
            const newSkill = this.availableSkills[nextIndex];
            if (window.electronAPI && window.electronAPI.updateActiveSkill) {
                window.electronAPI.updateActiveSkill(newSkill).then(() => {
                    this.currentSkill = newSkill;
                    this.updateSkillIndicator();
                    this.showSkillChangeNotification(newSkill, 1);
                });
            } else {
                this.currentSkill = newSkill;
                this.updateSkillIndicator();
            }
        });

        // Check for required elements (settingsIndicator is optional)
        if (this.settingsIndicator) {
            this.settingsIndicator.addEventListener('click', () => {
                if (this.isInteractive) {
                    this.showSettingsMenu();
                }
            });
        }

        // Interview Prep panel (embedded in main window — no separate window needed)
        if (this.interviewPrepBtn) {
            this.interviewPrepBtn.addEventListener('click', () => {
                this.togglePrepSection();
            });
            this.checkInterviewContextStatus();
        }

        const prepSaveBtn = document.getElementById('prepSaveBtn');
        const prepClearBtn = document.getElementById('prepClearBtn');
        if (prepSaveBtn) {
            prepSaveBtn.addEventListener('click', () => this.savePrepContext());
        }
        if (prepClearBtn) {
            prepClearBtn.addEventListener('click', () => this.clearPrepContext());
        }

        // Mic button — open inline chat then start/stop recording
        this.micButton.addEventListener('click', () => {
            if (this.isInteractive) {
                if (this.isRecording) {
                    window.electronAPI.stopSpeechRecognition();
                } else {
                    this.openChatSection();
                    window.electronAPI.startSpeechRecognition();
                }
            }
        });

        // Inline chat: send button + Enter key
        const inlineSend = document.getElementById('inlineSend');
        const inlineChatInput = document.getElementById('inlineChatInput');
        const chatClearBtn = document.getElementById('chatClearBtn');
        const audioSourceBtn = document.getElementById('audioSourceBtn');
        if (inlineSend) inlineSend.addEventListener('click', () => this.sendInlineMessage());
        if (chatClearBtn) chatClearBtn.addEventListener('click', () => this.clearInlineChat());
        if (audioSourceBtn) audioSourceBtn.addEventListener('click', () => this.toggleAudioSource());
        if (inlineChatInput) {
            inlineChatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendInlineMessage();
                }
            });
            inlineChatInput.addEventListener('input', () => {
                inlineChatInput.style.height = 'auto';
                inlineChatInput.style.height = Math.min(inlineChatInput.scrollHeight, 90) + 'px';
            });
        }

        // Set up all inline chat IPC listeners
        this.initInlineChatListeners();

        // Language dropdown
        this.languageSelect = document.getElementById('codingLanguage');
        if (this.languageSelect) {
            // Set default to C++ if no value is set
            this.languageSelect.value = 'cpp';
            
            // Initialize with current setting
            if (window.electronAPI && window.electronAPI.getSettings) {
                window.electronAPI.getSettings().then(settings => {
                    if (settings && settings.codingLanguage) {
                        this.languageSelect.value = settings.codingLanguage;
                    } else {
                        // Save C++ as default if no language is set
                        this.languageSelect.value = 'cpp';
                        window.electronAPI.saveSettings({ codingLanguage: 'cpp' });
                    }
                }).catch(() => {
                    // Fallback to C++ on error
                    this.languageSelect.value = 'cpp';
                });
            }

            this.languageSelect.addEventListener('change', (e) => {
                const lang = e.target.value;
                if (window.electronAPI && window.electronAPI.saveSettings) {
                    window.electronAPI.saveSettings({ codingLanguage: lang });
                }
                // Resize for any width change
                setTimeout(() => {
                    const commandTab = document.querySelector('.command-tab');
                    if (commandTab && window.electronAPI && window.electronAPI.resizeWindow) {
                        const rect = commandTab.getBoundingClientRect();
                        window.electronAPI.resizeWindow(Math.ceil(rect.width), Math.ceil(rect.height));
                    }
                }, 50);
            });
        }

        // Info button / shortcuts popover
        if (this.infoButton && this.shortcutsPopover) {
            this.infoButton.addEventListener('click', (e) => {
                if (!this.isInteractive) return;
                e.stopPropagation();
                this.toggleShortcutsPopover();
            });

            // Hover to show
            this.infoButton.addEventListener('mouseenter', () => {
                if (!this.isInteractive) return;
                this.showShortcutsPopover();
            });
            // Queue hide when leaving the button
            this.infoButton.addEventListener('mouseleave', () => this.queueHideShortcutsPopover());

            // Keep open when hovering popover
            this.shortcutsPopover.addEventListener('mouseenter', () => {
                if (this._popoverHideTimeout) {
                    clearTimeout(this._popoverHideTimeout);
                    this._popoverHideTimeout = null;
                }
            });
            // Hide after a small delay when leaving popover
            this.shortcutsPopover.addEventListener('mouseleave', () => this.queueHideShortcutsPopover());

            // Close on outside click
            document.addEventListener('click', (e) => {
                if (!this.shortcutsPopover) return;
                const isClickInside = this.shortcutsPopover.contains(e.target) || this.infoButton.contains(e.target);
                if (!isClickInside && this.shortcutsPopover.classList.contains('is-open')) {
                    this.hideShortcutsPopover();
                }
            });

            // Close on Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.shortcutsPopover && this.shortcutsPopover.classList.contains('is-open')) {
                    this.hideShortcutsPopover();
                }
            });
        }
    }

    setupEventListeners() {
        if (window.electronAPI) {
            // Fix interaction mode change listener
            window.electronAPI.onInteractionModeChanged((event, interactive) => {
                logger.debug('Interaction mode changed received:', interactive);
                this.handleInteractionModeChanged(interactive);
            });

            window.electronAPI.onRecordingStarted(() => {
                this.handleRecordingStarted();
            });

            window.electronAPI.onRecordingStopped(() => {
                this.handleRecordingStopped();
            });

            window.electronAPI.onSkillChanged((event, data) => {
                if (data && data.skill) {
                    this.handleSkillChanged(data);
                }
            });

            window.electronAPI.onSpeechAvailability((event, data) => {
                this.speechAvailable = !!(data && data.available);
                this.applyMicVisibility();
            });

            // Listen for coding language changes from other windows
            window.electronAPI.onCodingLanguageChanged((event, data) => {
                if (data && data.language && this.languageSelect) {
                    // avoid clobbering if same value
                    if (this.languageSelect.value !== data.language) {
                        this.languageSelect.value = data.language;
                    }
                    logger.debug('Language updated from other window', {
                        component: 'MainWindowUI',
                        language: data.language
                    });
                }
            });
            
            // Global keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if (e.altKey && e.key === 'r' && this.isInteractive) {
                    e.preventDefault();
                    if (!this.speechAvailable) return; // guard when unavailable
                    if (this.isRecording) {
                        window.electronAPI.stopSpeechRecognition();
                    } else {
                        window.electronAPI.startSpeechRecognition();
                    }
                }
            });
        }
        
        // Also listen via the api interface for backup
        if (window.api) {
            
            window.api.receive('interaction-mode-changed', (interactive) => {
                logger.debug('Interaction mode changed via api:', interactive);
                this.handleInteractionModeChanged(interactive);
            });
            
            window.api.receive('skill-updated', (data) => {
                logger.info('Skill updated event received from main process:', data);
                if (data && data.skill) {
                    this.handleSkillChanged(data);
                } else if (typeof data === 'string') {
                    // Handle case where skill is passed directly as string
                    this.handleSkillChanged({ skill: data });
                } else {
                    logger.warn('Skill updated event received but no skill data found:', data);
                }
            });
            
            // Listen for skill updates from settings window  
            window.api.receive('update-skill', (skill) => {
                logger.info('Direct skill update received from settings:', skill);
                this.handleSkillChanged({ skill: skill });
            });
        } else {
            logger.error('window.api not available - event listeners not set up!');
        }
        
        // Keyboard shortcuts
        this.setupKeyboardShortcuts();
        
        // Settings shortcut
        this.setupSettingsShortcut();
    }

    handleLLMResponse(data) {
        const skill = data.skill || data.metadata?.skill || 'General';
        const skillNames = {
            'cloud-engineering': 'Cloud Eng',
            'sre': 'SRE',
            'platform-engineering': 'Platform Eng',
            'infrastructure-engineering': 'Infra Eng',
            'devops-engineering': 'DevOps',
            'devsecops-engineering': 'DevSecOps',
            'cicd-engineering': 'CI/CD',
            'release-engineering': 'Release Eng',
            'build-engineering': 'Build Eng',
            'automation-engineering': 'Automation',
            'iac-engineering': 'IaC',
            'kubernetes-engineering': 'Kubernetes',
            'observability-engineering': 'Observability',
            'monitoring-engineering': 'Monitoring',
            'cloud-security-engineering': 'Cloud Security',
            'systems-engineering': 'Systems Eng',
            'network-engineering': 'Networking',
            'performance-engineering': 'Performance',
            'reliability-engineering': 'Reliability',
            'operations-engineering': 'Operations',
            'ai-specialist': 'AI Engineer',
            'backend-engineering': 'Backend Eng',
            'microsoft-dynamics': 'Dynamics 365',
        };
        
        const displaySkill = skillNames[skill] || skill.toUpperCase();
        
        logger.info('LLM response received', {
            component: 'MainWindowUI',
            skill: skill,
            displaySkill: displaySkill
        });
    }

    handleLLMError(data) {
        logger.error('LLM error received', {
            component: 'MainWindowUI',
            error: data.error
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.metaKey && e.key === '\\') {
                this.isHidden = !this.isHidden;
                if (this.isHidden) {
                    this.showHiddenIndicator();
                }
            }
            
            // Handle Cmd + Arrow keys based on interaction mode
            if (e.metaKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();

                if (this.isInteractive) {
                    // Interactive mode: Cmd + Up/Down for skill navigation
                    if (e.key === 'ArrowUp') {
                        this.navigateSkill(-1); // Previous skill
                    } else if (e.key === 'ArrowDown') {
                        this.navigateSkill(1); // Next skill
                    } else {
                    }
                    // Left/Right arrows do nothing in interactive mode
                } else {
                    // Non-interactive mode: Cmd + Arrow keys for window movement
                    this.moveWindow(e.key);
                }
            }
            
            // Alt+A is handled globally by the main process
            // No need to handle it here since it needs to work even when windows are non-interactive
        });
    }

    handleInteractionModeChanged(interactive) {
        logger.info('Handling interaction mode change', {
            component: 'MainWindowUI',
            newState: interactive,
            previousState: this.isInteractive
        });
        
        // Update the internal state
        this.isInteractive = interactive;
        
        // Update all UI elements to reflect the new state
        this.updateAllElementStates();

        // Auto-hide popover when leaving interactive mode
        if (!this.isInteractive && this.shortcutsPopover && this.shortcutsPopover.style.display !== 'none') {
            this.hideShortcutsPopover();
        }
        
        // Update skill indicator tooltip
        this.updateSkillIndicator();
        
        logger.info('Interaction mode change completed', {
            component: 'MainWindowUI',
            interactive: this.isInteractive,
            statusDotClass: this.statusDot ? this.statusDot.className : 'not found',
            skillIndicatorClass: this.skillIndicator ? this.skillIndicator.className : 'not found'
        });
    }

    handleSkillChanged(data) {
        const oldSkill = this.currentSkill;
        this.currentSkill = data.skill;
        
        logger.info('Handling skill change', {
            component: 'MainWindowUI',
            oldSkill: oldSkill,
            newSkill: data.skill,
            skillIndicatorExists: !!this.skillIndicator
        });
        
        this.updateSkillIndicator();
        
        logger.info('Skill changed successfully', {
            component: 'MainWindowUI',
            skill: data.skill
        });
    }

    handleSkillActivated(skillName) {
        this.currentSkill = skillName;
        this.updateSkillIndicator();
        
        logger.info('Skill activated', {
            component: 'MainWindowUI',
            skill: skillName
        });
    }

    handleScreenshotRequest() {
        logger.debug('Screenshot request received', { component: 'MainWindowUI' });
    }

    handleRecordingStarted() {
        this.isRecording = true;
        if (this.micButton) {
            this.micButton.classList.add('recording');
            const label = this.micButton.querySelector('.btn-label');
            const hint  = this.micButton.querySelector('.btn-hint');
            if (label) label.textContent = 'Recording…';
            if (hint)  hint.textContent  = 'Press Alt+R to stop';
        }
        logger.debug('Recording started', { component: 'MainWindowUI' });
    }

    handleRecordingStopped() {
        this.isRecording = false;
        if (this.micButton) {
            this.micButton.classList.remove('recording');
            const label = this.micButton.querySelector('.btn-label');
            const hint  = this.micButton.querySelector('.btn-hint');
            if (label) label.textContent = 'Record';
            if (hint)  hint.textContent  = 'Press to start listening';
        }
        logger.debug('Recording stopped', { component: 'MainWindowUI' });
    }

    updateSkillIndicator() {
        const skillNames = {
            'cloud-engineering': 'Cloud Eng',
            'sre': 'SRE',
            'platform-engineering': 'Platform Eng',
            'infrastructure-engineering': 'Infra Eng',
            'devops-engineering': 'DevOps',
            'devsecops-engineering': 'DevSecOps',
            'cicd-engineering': 'CI/CD',
            'release-engineering': 'Release Eng',
            'build-engineering': 'Build Eng',
            'automation-engineering': 'Automation',
            'iac-engineering': 'IaC',
            'kubernetes-engineering': 'Kubernetes',
            'observability-engineering': 'Observability',
            'monitoring-engineering': 'Monitoring',
            'cloud-security-engineering': 'Cloud Security',
            'systems-engineering': 'Systems Eng',
            'network-engineering': 'Networking',
            'performance-engineering': 'Performance',
            'reliability-engineering': 'Reliability',
            'operations-engineering': 'Operations',
            'ai-specialist': 'AI Engineer',
            'backend-engineering': 'Backend Eng',
            'microsoft-dynamics': 'Dynamics 365',
        };
        
        logger.info('Updating skill indicator', {
            component: 'MainWindowUI',
            currentSkill: this.currentSkill,
            skillIndicatorExists: !!this.skillIndicator
        });
        
        if (!this.skillIndicator) {
            logger.error('Skill indicator element not found!');
            return;
        }
        
        const skillName = skillNames[this.currentSkill] || this.currentSkill.toUpperCase();
        const skillSpan = this.skillIndicator.querySelector('.skill-name') || this.skillIndicator.querySelector('span');
        
        logger.info('Looking for skill span element', {
            component: 'MainWindowUI',
            spanExists: !!skillSpan,
            skillName: skillName
        });
        
        if (skillSpan) {
            const oldText = skillSpan.textContent;
            skillSpan.textContent = skillName;
                        
            const tooltip = this.isInteractive ? 
                `${skillName} - Use ⌘↑/↓ to navigate skills` : 
                `${skillName} - Enable interactive mode (Alt+A) to navigate`;
            this.skillIndicator.title = tooltip;
            
            // Add visual feedback for skill change
            this.animateSkillChange();
            
            logger.info('Skill indicator updated successfully', {
                component: 'MainWindowUI',
                oldText: oldText,
                newText: skillName,
                interactive: this.isInteractive
            });
        } else {
            logger.error('Skill span element not found within skill indicator!');
        }
    }

    animateSkillChange() {
        if (this.skillIndicator) {
            this.skillIndicator.style.transform = 'scale(1.1)';
            this.skillIndicator.style.transition = 'transform 0.2s ease';
            
            setTimeout(() => {
                this.skillIndicator.style.transform = 'scale(1)';
            }, 200);
        }
    }

    navigateSkill(direction) {
        
        const currentIndex = this.availableSkills.indexOf(this.currentSkill);
        if (currentIndex === -1) {
            logger.error('Current skill not found in available skills array');
            return;
        }
        
        // Calculate new index with wrapping
        let newIndex = currentIndex + direction;
        if (newIndex >= this.availableSkills.length) {
            newIndex = 0; // Wrap to beginning
        } else if (newIndex < 0) {
            newIndex = this.availableSkills.length - 1; // Wrap to end
        }
        
        const newSkill = this.availableSkills[newIndex];
        
        // Update skill locally and notify main process
        this.currentSkill = newSkill;
        this.updateSkillIndicator();
        
        // Save the skill change via IPC
        if (window.electronAPI && window.electronAPI.updateActiveSkill) {
            window.electronAPI.updateActiveSkill(newSkill).then(() => {
                logger.info('Skill navigation completed', {
                    component: 'MainWindowUI',
                    newSkill,
                    direction: direction > 0 ? 'down' : 'up'
                });
            }).catch(error => {
                logger.error('Failed to update skill via navigation', {
                    component: 'MainWindowUI',
                    error: error.message
                });
            });
        }
        
        // Show visual feedback
        this.showSkillChangeNotification(newSkill, direction);
    }

    showSkillChangeNotification(skill, direction) {
        const skillNames = {
            'cloud-engineering': 'Cloud Eng',
            'sre': 'SRE',
            'platform-engineering': 'Platform Eng',
            'infrastructure-engineering': 'Infra Eng',
            'devops-engineering': 'DevOps',
            'devsecops-engineering': 'DevSecOps',
            'cicd-engineering': 'CI/CD',
            'release-engineering': 'Release Eng',
            'build-engineering': 'Build Eng',
            'automation-engineering': 'Automation',
            'iac-engineering': 'IaC',
            'kubernetes-engineering': 'Kubernetes',
            'observability-engineering': 'Observability',
            'monitoring-engineering': 'Monitoring',
            'cloud-security-engineering': 'Cloud Security',
            'systems-engineering': 'Systems Eng',
            'network-engineering': 'Networking',
            'performance-engineering': 'Performance',
            'reliability-engineering': 'Reliability',
            'operations-engineering': 'Operations',
            'ai-specialist': 'AI Engineer',
            'backend-engineering': 'Backend Eng',
            'microsoft-dynamics': 'Dynamics 365',
        };
        
        const displayName = skillNames[skill] || skill.toUpperCase();
        const arrow = direction > 0 ? '→' : '←';

        // Use dedicated toast element from new panel design, fall back to floating div
        const toast = document.getElementById('skillToast');
        if (toast) {
            toast.textContent = `${arrow} ${displayName}`;
            toast.classList.add('show');
            clearTimeout(toast._hideTimer);
            toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 1200);
            return;
        }

        // Fallback for older layout
        const notification = document.createElement('div');
        notification.innerHTML = `${arrow} ${displayName}`;
        notification.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:white;padding:8px 16px;border-radius:6px;font-size:14px;font-weight:600;z-index:1000;opacity:0;transition:opacity 0.2s ease;`;
        document.body.appendChild(notification);
        setTimeout(() => { notification.style.opacity = '1'; }, 10);
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => { if (notification.parentNode) notification.parentNode.removeChild(notification); }, 200);
        }, 1000);
    }

    showHiddenIndicator() {
        const indicator = document.querySelector('.hidden-indicator');
        if (indicator) {
            indicator.classList.add('show');
            setTimeout(() => {
                indicator.classList.remove('show');
            }, 3000);
        }
    }

    toggleInteractiveMode() {
        this.isInteractive = !this.isInteractive;
        this.updateAllElementStates();
        
        logger.debug('Interactive mode toggled', {
            component: 'MainWindowUI',
            interactive: this.isInteractive
        });
    }

    moveWindow(direction) {
        const moveDistance = 20; // pixels
        
        if (window.electronAPI && window.electronAPI.moveWindow) {
            let deltaX = 0, deltaY = 0;
            
            switch(direction) {
                case 'ArrowUp':
                    deltaY = -moveDistance;
                    break;
                case 'ArrowDown':
                    deltaY = moveDistance;
                    break;
                case 'ArrowLeft':
                    deltaX = -moveDistance;
                    break;
                case 'ArrowRight':
                    deltaX = moveDistance;
                    break;
            }
            
            window.electronAPI.moveWindow(deltaX, deltaY);
            logger.debug('Moving window', {
                component: 'MainWindowUI',
                direction: direction,
                deltaX: deltaX,
                deltaY: deltaY,
                interactive: this.isInteractive
            });
        } else {
            logger.warn('moveWindow API not available', { component: 'MainWindowUI' });
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 p-4 rounded-lg text-white z-50 ${
            type === 'error' ? 'bg-red-600' : 
            type === 'success' ? 'bg-green-600' :
            'bg-blue-600'
        }`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
        
        logger.debug('Notification shown', {
            component: 'MainWindowUI',
            message,
            type
        });
    }

    // ── Inline Chat / Response Panel ───────────────────────────────────────────

    openChatSection() {
        // Chat section is always visible — scroll only if user is already at the bottom
        this._scrollInlineMsgs();
    }

    closeChatSection() {
        // No-op — chat section stays visible
    }

    _setupInlineMsgsScrollTracking() {
        const msgs = document.getElementById('inlineMsgs');
        if (!msgs || msgs.dataset.scrollTracking === '1') return;
        msgs.dataset.scrollTracking = '1';
        msgs.addEventListener('scroll', () => {
            const distFromBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight;
            // Within 40px of the bottom counts as "at bottom" — re-enable auto-scroll
            this._userScrolledUp = distFromBottom > 40;
        });
    }

    _scrollInlineMsgs(force = false) {
        const msgs = document.getElementById('inlineMsgs');
        if (!msgs) return;
        if (force) this._userScrolledUp = false;
        if (force || !this._userScrolledUp) {
            msgs.scrollTop = msgs.scrollHeight;
        }
    }

    _scrollInlineMsgToTop(element) {
        const msgs = document.getElementById('inlineMsgs');
        if (!msgs || !element) return;
        const targetTop = Math.max(0, element.offsetTop - msgs.offsetTop - 8);
        msgs.scrollTop = targetTop;
        // Treat this as an intentional read position so streaming chunks do not
        // pull the viewport down while the first lines are being read.
        this._userScrolledUp = true;
    }

    _hideEmptyState() {
        const empty = document.getElementById('chatEmpty');
        if (empty) empty.style.display = 'none';
    }

    _addInlineMsg(text, type = 'assistant') {
        const msgs = document.getElementById('inlineMsgs');
        if (!msgs) return null;
        this._hideEmptyState();
        const div = document.createElement('div');
        div.className = `im im-${type}`;
        if (type === 'thinking') {
            div.innerHTML = '<span class="thinking-dots"><span>•</span><span>•</span><span>•</span></span>';
        } else {
            div.textContent = text;
        }
        msgs.appendChild(div);
        this._scrollInlineMsgs();
        // Grow the Electron window so the chat panel and input are always fully visible.
        this.resizeWindowToContent();
        return div;
    }

    clearInlineChat() {
        const msgs = document.getElementById('inlineMsgs');
        if (!msgs) return;
        msgs.innerHTML = `<div class="chat-empty" id="chatEmpty">
            <i class="fas fa-microphone-lines"></i>
            <span>Press <strong>Alt+R</strong> to record,<br>take a screenshot, or type below.</span>
        </div>`;
        if (this._dedupeSet) this._dedupeSet.clear();
        this._streamingDiv = null;
        this._interimDiv = null;
    }

    _renderInlineMarkdown(text) {
        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Split on fenced code blocks so they are rendered separately from prose.
        // Using a capturing group keeps the delimiters in the parts array.
        const parts = text.split(/(```[a-z]*\n?[\s\S]*?```)/g);

        return parts.map((part) => {
            // ── Fenced code block ─────────────────────────────────────────────
            const cb = part.match(/^```([a-z]*)\n?([\s\S]*?)```$/);
            if (cb) {
                const lang = cb[1] || '';
                const code = esc(cb[2] || '').trim();
                const header = lang
                    ? `<div style="padding:2px 10px;background:rgba(0,0,0,0.4);border-bottom:1px solid rgba(255,255,255,0.07);font-size:10px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:rgba(79,195,247,0.8);">${lang}</div>`
                    : '';
                return `<div style="margin:6px 0;border-radius:7px;overflow:hidden;border:1px solid rgba(255,255,255,0.10);">${header}<pre style="margin:0;padding:9px 11px;background:rgba(0,0,0,0.45);font-family:'Consolas','Fira Code',monospace;font-size:11.5px;line-height:1.55;color:rgba(255,255,255,0.88);overflow-x:auto;white-space:pre;">${code}</pre></div>`;
            }

            // ── Regular prose ─────────────────────────────────────────────────
            return esc(part)
                // headings
                .replace(/^### (.+)$/gm, '<strong style="font-size:13px;color:rgba(167,139,250,0.9);">$1</strong>')
                .replace(/^## (.+)$/gm,  '<strong style="font-size:14px;color:rgba(167,139,250,1);">$1</strong>')
                .replace(/^# (.+)$/gm,   '<strong style="font-size:15px;color:#fff;">$1</strong>')
                // bold / italic
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                // inline code
                .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.35);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:11px;color:rgba(79,195,247,0.9);">$1</code>')
                // bullet points
                .replace(/^[\-\*] (.+)$/gm, '<span style="display:block;padding-left:12px;">• $1</span>')
                // newlines
                .replace(/\n/g, '<br>');
        }).join('');
    }

    _addInlineMsgHTML(html, type = 'assistant') {
        const msgs = document.getElementById('inlineMsgs');
        if (!msgs) return null;
        this._hideEmptyState();
        const div = document.createElement('div');
        div.className = `im im-${type}`;
        div.innerHTML = html;
        msgs.appendChild(div);
        this._scrollInlineMsgs();
        // Grow the Electron window so the chat panel and input are always fully visible.
        this.resizeWindowToContent();
        return div;
    }

    _removeThinking() {
        const msgs = document.getElementById('inlineMsgs');
        if (!msgs) return;
        const thinking = msgs.querySelector('.im-thinking');
        if (thinking) thinking.remove();
    }

    _isDupe(text) {
        if (!this._dedupeSet) this._dedupeSet = new Set();
        const key = text.trim().slice(0, 120);
        if (this._dedupeSet.has(key)) return true;
        this._dedupeSet.add(key);
        if (this._dedupeSet.size > 60) {
            this._dedupeSet.delete(this._dedupeSet.values().next().value);
        }
        return false;
    }

    toggleAudioSource() {
        this._audioSource = this._audioSource === 'mic' ? 'system' : 'mic';
        const btn = document.getElementById('audioSourceBtn');
        const lbl = document.getElementById('audioSourceLabel');
        const isSys = this._audioSource === 'system';
        if (lbl) lbl.textContent = isSys ? 'SYS' : 'MIC';
        if (btn) {
            btn.style.color = isSys ? '#4fc3f7' : '';
            btn.style.borderColor = isSys ? 'rgba(79,195,247,0.35)' : '';
            btn.style.background = isSys ? 'rgba(79,195,247,0.10)' : '';
            btn.title = isSys
                ? 'Audio source: System Audio (Meet/Teams) — click to switch to Mic'
                : 'Audio source: Microphone — click to switch to System Audio';
        }
        this._addInlineMsg(
            isSys ? 'Audio source: System Audio (Meet/Teams)' : 'Audio source: Microphone',
            'system'
        );
        if (window.electronAPI && window.electronAPI.setAudioSource) {
            window.electronAPI.setAudioSource(this._audioSource).catch(() => {});
        }
    }

    sendInlineMessage() {
        const input = document.getElementById('inlineChatInput');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        this.openChatSection();
        this._userScrolledUp = false;
        this._addInlineMsg(text, 'user');
        input.value = '';
        input.style.height = 'auto';
        // Do NOT add a thinking indicator here — the main process sends 'chat-thinking'
        // immediately, which adds one via onChatThinking. A second one here caused
        // _removeThinking() to leave a leftover that blocked new streaming divs.
        if (window.electronAPI && window.electronAPI.sendChatMessage) {
            window.electronAPI.sendChatMessage(text).catch(() => {});
        }
    }

    initInlineChatListeners() {
        const api = window.electronAPI;
        if (!api) return;

        this._setupInlineMsgsScrollTracking();

        // Recording started — show indicator in header
        api.onRecordingStarted && api.onRecordingStarted(() => {
            const bar = document.getElementById('recBar');
            const txt = document.getElementById('recBarTxt');
            if (bar) bar.style.display = 'flex';
            if (txt) txt.textContent = 'Listening…';
        });

        // Recording stopped — update indicator and clear any dangling interim ghost.
        api.onRecordingStopped && api.onRecordingStopped(() => {
            const txt = document.getElementById('recBarTxt');
            if (txt) txt.textContent = 'Processing…';
            if (this._interimDiv) {
                this._interimDiv.remove();
                this._interimDiv = null;
            }
        });

        // Live interim speech — single updating div so it doesn't flood the chat.
        api.onInterimTranscription && api.onInterimTranscription((event, data) => {
            if (!data || !data.text) return;
            this._hideEmptyState();
            const msgs = document.getElementById('inlineMsgs');
            if (!msgs) return;
            if (!this._interimDiv) {
                this._interimDiv = document.createElement('div');
                this._interimDiv.className = 'im im-interim';
                msgs.appendChild(this._interimDiv);
            }
            this._interimDiv.textContent = data.text.trim();
            this._scrollInlineMsgs();
        });

        // Final sentence confirmed — replace the interim ghost with a solid transcription line.
        api.onTranscriptionReceived && api.onTranscriptionReceived((event, data) => {
            if (data && data.text) {
                // Reuse the interim div for this sentence so there's no visual jump.
                if (this._interimDiv) {
                    this._interimDiv.className = 'im im-transcription';
                    this._interimDiv.textContent = data.text.trim();
                    this._interimDiv = null; // next interim creates a fresh ghost
                } else {
                    this._addInlineMsg(data.text.trim(), 'transcription');
                }
                this._scrollInlineMsgs();
            }
        });

        // AI response to voice input — hide recording bar
        api.onTranscriptionLlmResponse && api.onTranscriptionLlmResponse((event, data) => {
            const bar = document.getElementById('recBar');
            if (bar) bar.style.display = 'none';
            this._removeThinking();

            // Always capture and clear _streamingDiv FIRST so the next request
            // always gets a fresh div, regardless of whether we render this response.
            const sd = this._streamingDiv;
            this._streamingDiv = null;

            if (data && data.response && !this._isDupe(data.response)) {
                if (sd) {
                    // Upgrade the existing streaming div with rendered markdown in-place.
                    sd.innerHTML = this._renderInlineMarkdown(data.response);
                    this.resizeWindowToContent();
                } else {
                    const div = this._addInlineMsgHTML(this._renderInlineMarkdown(data.response), 'assistant');
                    this._scrollInlineMsgToTop(div);
                }
            }
        });

        // Streaming chunks — use this._streamingDiv exclusively (no local variable).
        // A local variable would keep pointing to the previous response's div after it
        // was upgraded in-place, causing all subsequent streams to append to the old element.
        let _streamResizeDone = false;
        api.onLlmStreamChunk && api.onLlmStreamChunk((event, data) => {
            if (data && data.chunk) {
                this._removeThinking();
                // Create a fresh streaming div if none exists or the previous one was finalised.
                if (!this._streamingDiv || !document.getElementById('inlineMsgs')?.contains(this._streamingDiv)) {
                    this._streamingDiv = this._addInlineMsg('', 'assistant');
                    this._scrollInlineMsgToTop(this._streamingDiv);
                    _streamResizeDone = false;
                }
                if (this._streamingDiv) {
                    this._streamingDiv.textContent = (this._streamingDiv.textContent || '') + data.chunk;
                    // Resize once per burst so the window grows with content.
                    if (!_streamResizeDone) {
                        _streamResizeDone = true;
                        setTimeout(() => {
                            this.resizeWindowToContent();
                            _streamResizeDone = false;
                        }, 300);
                    }
                }
            }
        });

        // Thinking indicator (when LLM starts processing typed chat)
        api.onChatThinking && api.onChatThinking(() => {
            this.openChatSection();
            this._addInlineMsg('', 'thinking');
        });

        // Screenshot / OCR response
        api.onInlineLlmLoading && api.onInlineLlmLoading(() => {
            this.openChatSection();
            this._addInlineMsg('Analyzing screenshot…', 'system');
        });

        api.onInlineLlmResponse && api.onInlineLlmResponse((event, data) => {
            this._removeThinking();
            const sd = this._streamingDiv;
            this._streamingDiv = null;
            const content = data && (data.content || data.response);
            if (content && !this._isDupe(content)) {
                if (sd) {
                    sd.innerHTML = this._renderInlineMarkdown(content);
                    this.resizeWindowToContent();
                } else {
                    const div = this._addInlineMsgHTML(this._renderInlineMarkdown(content), 'assistant');
                    this._scrollInlineMsgToTop(div);
                }
            }
        });

        // Also catch the generic llm-response broadcast (screenshot answers)
        api.onLlmResponse && api.onLlmResponse((event, data) => {
            this._removeThinking();
            const sd = this._streamingDiv;
            this._streamingDiv = null;
            const content = data && (data.content || data.response);
            if (content && !this._isDupe(content)) {
                if (sd) {
                    sd.innerHTML = this._renderInlineMarkdown(content);
                    this.resizeWindowToContent();
                } else {
                    const div = this._addInlineMsgHTML(this._renderInlineMarkdown(content), 'assistant');
                    this._scrollInlineMsgToTop(div);
                }
            }
        });
    }

    // ── Interview Prep (embedded panel) ────────────────────────────────────────

    togglePrepSection() {
        const section = document.getElementById('prepSection');
        if (!section) return;
        const isOpen = section.style.display !== 'none';
        if (isOpen) {
            section.style.display = 'none';
            this.interviewPrepBtn.classList.remove('context-loaded');
            this.checkInterviewContextStatus(); // restore badge if context exists
        } else {
            section.style.display = 'block';
            this.interviewPrepBtn.classList.add('context-loaded');
            this.loadPrepContext();
        }
        setTimeout(() => this.resizeWindowToContent(), 50);
    }

    async loadPrepContext() {
        try {
            if (!window.electronAPI || !window.electronAPI.getInterviewContext) return;
            const ctx = await window.electronAPI.getInterviewContext();
            if (ctx) {
                const cvTA = document.getElementById('prepCvTA');
                const jdTA = document.getElementById('prepJdTA');
                if (cvTA && ctx.cv) cvTA.value = ctx.cv;
                if (jdTA && ctx.jd) jdTA.value = ctx.jd;
                if (ctx.cv || ctx.jd) this.setPrepStatus('Previous context loaded.', '#34d399');
            }
        } catch (e) { /* ignore */ }
    }

    async savePrepContext() {
        const cvTA = document.getElementById('prepCvTA');
        const jdTA = document.getElementById('prepJdTA');
        const cv = cvTA ? cvTA.value.trim() : '';
        const jd = jdTA ? jdTA.value.trim() : '';

        if (!cv && !jd) {
            this.setPrepStatus('Paste at least a CV or JD first.', '#f87171');
            return;
        }
        try {
            if (window.electronAPI && window.electronAPI.saveInterviewContext) {
                await window.electronAPI.saveInterviewContext({ cv, jd });
            }
            this.setPrepStatus('Saved! AI will use this context.', '#34d399');
            this.checkInterviewContextStatus();
            const btn = document.getElementById('prepSaveBtn');
            if (btn) {
                const orig = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check-circle"></i> Saved!';
                btn.style.color = '#34d399';
                setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
            }
        } catch (err) {
            this.setPrepStatus('Error: ' + err.message, '#f87171');
        }
    }

    async clearPrepContext() {
        const cvTA = document.getElementById('prepCvTA');
        const jdTA = document.getElementById('prepJdTA');
        if (cvTA) cvTA.value = '';
        if (jdTA) jdTA.value = '';
        try {
            if (window.electronAPI && window.electronAPI.clearInterviewContext) {
                await window.electronAPI.clearInterviewContext();
            }
        } catch (e) { /* ignore */ }
        this.setPrepStatus('Context cleared.', 'rgba(255,255,255,0.38)');
        this.checkInterviewContextStatus();
    }

    setPrepStatus(msg, color) {
        const txt = document.getElementById('prepStatusTxt');
        const row = document.getElementById('prepStatus');
        if (txt) txt.textContent = msg;
        if (row) row.style.color = color || 'rgba(255,255,255,0.38)';
    }

    async checkInterviewContextStatus() {
        try {
            if (!window.electronAPI || !window.electronAPI.getInterviewContext) return;
            const ctx = await window.electronAPI.getInterviewContext();
            const hasContext = ctx && (ctx.cv || ctx.jd);
            if (this.interviewPrepBtn) {
                this.interviewPrepBtn.classList.toggle('context-loaded', !!hasContext);
                this.interviewPrepBtn.title = hasContext
                    ? 'Interview context loaded — click to update'
                    : 'Upload CV & Job Description';
            }
        } catch (e) {
            // Non-critical, ignore
        }
    }

    async showGeminiConfig() {
        try {
            const status = await window.electronAPI.getGeminiStatus();
            
            const modal = this.createGeminiConfigModal(status);
            document.body.appendChild(modal);
            
            logger.debug('Gemini config modal shown', { component: 'MainWindowUI' });
        } catch (error) {
            logger.error('Failed to show Gemini config', {
                component: 'MainWindowUI',
                error: error.message
            });
            this.showNotification('Failed to load Gemini configuration', 'error');
        }
    }

    createGeminiConfigModal(status) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50';
        modal.innerHTML = `
            <div class="bg-gray-900 text-white p-6 rounded-lg max-w-md w-full">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-bold">🤖 OpenAI Configuration</h2>
                    <button class="text-gray-400 hover:text-white" onclick="this.closest('.fixed').remove()">✕</button>
                </div>
                
                <div class="mb-4 p-3 rounded ${status.hasApiKey ? 'bg-green-900' : 'bg-red-900'}">
                    <p><strong>Status:</strong> ${status.hasApiKey ? 'Configured' : 'Not Configured'}</p>
                    <p><strong>Model:</strong> ${status.model}</p>
                </div>
                
                <div class="mb-4">
                    <label class="block text-sm font-medium mb-2">API Key:</label>
                    <input type="password" id="openaiApiKey" placeholder="Enter your OpenAI API key (sk-...)" 
                           class="w-full p-2 bg-gray-800 border border-gray-600 rounded text-white">
                    <p class="text-xs text-gray-400 mt-1">
                        Get your API key from: <a href="https://platform.openai.com/api-keys" target="_blank" class="text-blue-400">OpenAI Platform</a>
                    </p>
                </div>
                
                <div class="flex space-x-2">
                    <button onclick="mainWindowUI.configureOpenAI()" class="flex-1 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded">
                        Configure
                    </button>
                    <button onclick="mainWindowUI.testOpenAIConnection()" class="flex-1 bg-green-600 hover:bg-green-700 px-4 py-2 rounded">
                        Test Connection
                    </button>
                </div>
                
                <div class="mt-4 text-center">
                    <button class="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded" onclick="this.closest('.fixed').remove()">
                        Close
                    </button>
                </div>
            </div>
        `;
        return modal;
    }

    async configureOpenAI() {
        const apiKey = document.getElementById('openaiApiKey').value.trim();
        if (!apiKey) {
            this.showNotification('Please enter an API key', 'error');
            return;
        }
        
        try {
            const result = await window.electronAPI.setOpenAIApiKey(apiKey);
            if (result.success) {
                this.showNotification('OpenAI API key configured successfully!', 'success');
                document.querySelector('.fixed').remove();
                
                logger.info('OpenAI API key configured', { component: 'MainWindowUI' });
            } else {
                this.showNotification(`Configuration failed: ${result.error}`, 'error');
                logger.error('OpenAI configuration failed', {
                    component: 'MainWindowUI',
                    error: result.error
                });
            }
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
            logger.error('OpenAI configuration error', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    async testOpenAIConnection() {
        try {
            const result = await window.electronAPI.testOpenAIConnection();
            if (result.success) {
                this.showNotification('OpenAI connection test successful!', 'success');
                logger.info('OpenAI connection test successful', { component: 'MainWindowUI' });
            } else {
                this.showNotification(`Connection test failed: ${result.error}`, 'error');
                logger.error('OpenAI connection test failed', {
                    component: 'MainWindowUI',
                    error: result.error
                });
            }
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
            logger.error('OpenAI connection test error', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    setupSettingsShortcut() {
        document.addEventListener('keydown', (e) => {
            // Cmd+, or Ctrl+, for settings
            if ((e.metaKey || e.ctrlKey) && e.key === ',') {
                logger.debug('Settings keyboard shortcut pressed');
                e.preventDefault();
                this.openSettings();
            }
        });
    }

    openSettings() {
        try {
            if (window.electronAPI && window.electronAPI.showSettings) {
                window.electronAPI.showSettings();
            } else {
                logger.error('electronAPI or showSettings not available');
                return;
            }
            
            // Add visual feedback
            if (this.settingsIndicator) {
                this.settingsIndicator.style.transform = 'scale(1.1)';
                this.settingsIndicator.style.transition = 'transform 0.2s ease';
                
                setTimeout(() => {
                    this.settingsIndicator.style.transform = 'scale(1)';
                }, 200);
            }
            
            logger.info('Settings window opened', { component: 'MainWindowUI' });
        } catch (error) {
            logger.error('Failed to open settings', {
                component: 'MainWindowUI',
                error: error.message
            });
            this.showNotification('Failed to open settings', 'error');
        }
    }

    showSettingsMenu() {
        const menu = document.createElement('div');
        menu.className = 'settings-menu';
        menu.style.cssText = `
            position: absolute;
            right: 10px;
            top: 35px;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(20px);
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            padding: 8px 0;
            min-width: 150px;
            z-index: 1000;
        `;

        const settingsOption = this.createMenuItem('Settings', 'fa-cog', () => {
            this.openSettings();
            document.body.removeChild(menu);
        });

        const quitOption = this.createMenuItem('Quit AgentSami', 'fa-power-off', () => {
            if (window.electronAPI) {
                window.electronAPI.quitApp();
            }
        });

        menu.appendChild(settingsOption);
        menu.appendChild(this.createMenuSeparator());
        menu.appendChild(quitOption);

        // Add click outside listener to close menu
        const closeMenu = (e) => {
            if (!menu.contains(e.target) && !this.settingsIndicator.contains(e.target)) {
                document.body.removeChild(menu);
                document.removeEventListener('click', closeMenu);
            }
        };
        document.addEventListener('click', closeMenu);

        document.body.appendChild(menu);
    }

    createMenuItem(text, iconClass, onClick) {
        const item = document.createElement('div');
        item.style.cssText = `
            padding: 8px 16px;
            color: rgba(255, 255, 255, 0.9);
            font-size: 13px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s ease;
        `;
        item.innerHTML = `<i class="fas ${iconClass}"></i>${text}`;
        item.addEventListener('mouseover', () => {
            item.style.background = 'rgba(255, 255, 255, 0.1)';
        });
        item.addEventListener('mouseout', () => {
            item.style.background = 'transparent';
        });
        item.addEventListener('click', onClick);
        return item;
    }

    createMenuSeparator() {
        const separator = document.createElement('div');
        separator.style.cssText = `
            height: 1px;
            background: rgba(255, 255, 255, 0.1);
            margin: 8px 0;
        `;
        return separator;
    }

    toggleShortcutsPopover() {
        if (!this.shortcutsPopover) return;
    const isOpen = this.shortcutsPopover.classList.contains('is-open');
    if (!isOpen) {
            this.showShortcutsPopover();
        } else {
            this.hideShortcutsPopover();
        }
    }

    showShortcutsPopover() {
        if (!this.shortcutsPopover) return;
        if (this._popoverHideTimeout) {
            clearTimeout(this._popoverHideTimeout);
            this._popoverHideTimeout = null;
        }
    this.shortcutsPopover.classList.add('is-open');
        // Resize main window to fit popover
        setTimeout(() => this.resizeWindowToContent(), 50);
    }

    hideShortcutsPopover() {
        if (!this.shortcutsPopover) return;
    this.shortcutsPopover.classList.remove('is-open');
    // resize back to compact after transition
    setTimeout(() => this.resizeWindowToContent(), 130);
    }

    queueHideShortcutsPopover() {
        if (!this.shortcutsPopover) return;
        if (this._popoverHideTimeout) clearTimeout(this._popoverHideTimeout);
        this._popoverHideTimeout = setTimeout(() => this.hideShortcutsPopover(), 180);
    }
}

// Initialize when DOM is ready
let mainWindowUI;
if (typeof document !== 'undefined') {
    // Add immediate visual indicator that script is loading
    const style = document.createElement('style');
    document.head.appendChild(style);
    
    document.addEventListener('DOMContentLoaded', () => {
                
        mainWindowUI = new MainWindowUI();
        // Make it globally accessible for debugging and inline button wiring
        window.mainWindowUI = mainWindowUI;
        window._mainWindowUI = mainWindowUI;
        logger.info('MainWindowUI initialized and available as window.mainWindowUI');
    });
}

// module.exports = MainWindowUI; // Not needed in browser context
