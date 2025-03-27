let currentEventSource = null;
let historyVisible = false; // Track history panel status
let activeWorkspaceTab = 'browser'; // Track current active workspace tab
let currentTaskId = null;
let isTaskBrowserOpen = false;
let exampleApiKey = '';

function createTask() {
    const promptInput = document.getElementById('prompt-input');
    const prompt = promptInput.value.trim();

    if (!prompt) {
        alert("Please enter a valid task");
        promptInput.focus();
        return;
    }

    if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
    }

    const taskContainer = document.getElementById('task-container');
    const stepsContainer = document.getElementById('steps-container');
    const container = document.querySelector('.container');
    const workspacePanel = document.getElementById('workspace-panel');

    // Reset UI state
    resetUIState();

    // Hide welcome message, show step loading status
    const welcomeMessage = taskContainer.querySelector('.welcome-message');
    if (welcomeMessage) {
        welcomeMessage.style.display = 'none';
    }

    stepsContainer.innerHTML = '<div class="loading">Initializing task...</div>';

    // Close history panel on mobile devices
    closeHistoryOnMobile();

    // Ensure workspace panel is always visible
    showWorkspacePanel();

    // Automatically switch to browser tab
    activateWorkspaceTab('browser');

    fetch('/tasks', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt })
    })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { throw new Error(err.detail || 'Request failed') });
            }
            return response.json();
        })
        .then(data => {
            if (!data.task_id) {
                throw new Error('Invalid task ID');
            }
            setupSSE(data.task_id);
            loadHistory();
            promptInput.value = '';
        })
        .catch(error => {
            stepsContainer.innerHTML = `<div class="error">Error: ${error.message}</div>`;
            console.error('Failed to create task:', error);
        });
}

// Independent function to reset UI state, avoid duplicate code
function resetUIState() {
    const container = document.querySelector('.container');
    const workspacePanel = document.getElementById('workspace-panel');

    // Ensure workspace is visible
    if (workspacePanel) {
        // Remove hidden class
        workspacePanel.classList.remove('hidden');
        // Ensure visibility
        workspacePanel.style.display = 'flex';
        workspacePanel.style.flexDirection = 'column';
    }

    // Ensure container has appropriate layout
    container.classList.add('with-workspace');

    // 设置固定宽度
    container.style.width = '98%';

    // 触发布局调整
    handleResponsiveLayout();
}

function setupSSE(taskId) {
    let retryCount = 0;
    const maxRetries = 3;
    const retryDelay = 2000;
    let stepsData = [];

    currentTaskId = taskId;

    setTimeout(() => {
        if (!isTaskBrowserOpen && currentTaskId) {
            openTaskBrowser();
        }
    }, 500);

    const stepsContainer = document.getElementById('steps-container');
    showWorkspacePanel();

    function connect() {
        const eventSource = new EventSource(`/tasks/${taskId}/events`);
        currentEventSource = eventSource;

        let heartbeatTimer = setInterval(() => {
            const pingDiv = document.createElement('div');
            pingDiv.className = 'ping';
            pingDiv.innerHTML = '·';
            stepsContainer.appendChild(pingDiv);
        }, 5000);

        fetch(`/tasks/${taskId}`)
            .then(response => response.json())
            .then(task => {
                updateTaskStatus(task);
            })
            .catch(error => {
                console.error('Initial status retrieval failed:', error);
            });

        const handleEvent = (event, type) => {
            clearInterval(heartbeatTimer);
            try {
                const data = JSON.parse(event.data);
                const loadingDiv = stepsContainer.querySelector('.loading');
                if (loadingDiv) loadingDiv.remove();

                const { formattedContent, timestamp, isoTimestamp } = formatStepContent(data, type);

                stepsData.push({
                    type: type,
                    content: formattedContent,
                    timestamp: timestamp,
                    isoTimestamp: isoTimestamp,
                    element: createStepElement(type, formattedContent, timestamp)
                });

                stepsData.sort((a, b) => {
                    return new Date(a.isoTimestamp) - new Date(b.isoTimestamp);
                });

                stepsContainer.innerHTML = '';
                stepsData.forEach(step => {
                    stepsContainer.appendChild(step.element);
                });

                document.querySelectorAll('.step-item').forEach(item => {
                    item.classList.remove('active');
                });

                const latestStep = stepsData[stepsData.length - 1];
                if (latestStep && latestStep.element) {
                    latestStep.element.classList.add('active');
                }

                autoScroll(stepsContainer);

                if (type === 'tool' || type === 'act') {
                    handleWorkspaceAction(data, type);
                }

                fetch(`/tasks/${taskId}`)
                    .then(response => response.json())
                    .then(task => {
                        updateTaskStatus(task);
                    })
                    .catch(error => {
                        console.error('Failed to update status:', error);
                    });
            } catch (e) {
                console.error(`Error processing ${type} event:`, e);
            }
        };

        const eventTypes = ['think', 'tool', 'act', 'log', 'run', 'message'];
        eventTypes.forEach(type => {
            eventSource.addEventListener(type, (event) => handleEvent(event, type));
        });

        eventSource.addEventListener('complete', (event) => {
            clearInterval(heartbeatTimer);
            try {
                fetch(`/tasks/${taskId}`)
                    .then(response => response.json())
                    .then(task => {
                        updateTaskStatus(task);
                    })
                    .catch(error => {
                        console.error('Failed to update final status:', error);
                    });

                eventSource.close();
                currentEventSource = null;
            } catch (e) {
                console.error('Error processing completion event:', e);
            }
        });

        eventSource.addEventListener('error', (event) => {
            clearInterval(heartbeatTimer);
            try {
                const data = JSON.parse(event.data);
                updateTaskStatus({ status: 'failed', error: data.message });

                eventSource.close();
                currentEventSource = null;
            } catch (e) {
                console.error('Error processing error:', e);
            }
        });

        eventSource.onerror = (err) => {
            if (eventSource.readyState === EventSource.CLOSED) return;

            console.error('SSE connection error:', err);
            clearInterval(heartbeatTimer);
            eventSource.close();

            fetch(`/tasks/${taskId}`)
                .then(response => response.json())
                .then(task => {
                    if (task.status === 'completed' || task.status === 'failed') {
                        updateTaskStatus(task);
                    } else if (retryCount < maxRetries) {
                        retryCount++;
                        const warningDiv = document.createElement('div');
                        warningDiv.className = 'warning';
                        warningDiv.innerHTML = `<div>⚠ Connection lost, retrying in ${retryDelay / 1000} seconds (${retryCount}/${maxRetries})...</div>`;
                        stepsContainer.appendChild(warningDiv);
                        setTimeout(connect, retryDelay);
                    } else {
                        updateTaskStatus({ status: 'failed', error: 'Connection lost, please refresh the page' });
                    }
                })
                .catch(error => {
                    console.error('Failed to check task status:', error);
                    if (retryCount < maxRetries) {
                        retryCount++;
                        setTimeout(connect, retryDelay);
                    }
                });
        };
    }

    connect();
}

// Handle workspace actions based on event data
function handleWorkspaceAction(data, type) {
    if (!data || !data.result) return;

    const result = data.result;
    showWorkspacePanel();

    // Browser related event handling
    if (type === 'tool' || type === 'act') {
        // Detect browser related events
        if (result.includes('browser') || result.includes('playwright') ||
            result.includes('http://') || result.includes('https://')) {

            // Activate browser tab
            activateWorkspaceTab('browser');

            // Extract URL
            const urlMatch = result.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch && urlMatch[1]) {
                const url = urlMatch[1];
                console.log('URL detected:', url);

                // Ensure browser container is ready
                const browserContainer = document.querySelector('.browser-container');
                if (browserContainer) {
                    // Delay a short time to ensure DOM updates are complete
                    setTimeout(() => {
                        console.log('Loading URL:', url);
                        navigateToUrl(url);

                        // If page is not loaded after 5 seconds, refresh automatically
                        setTimeout(() => {
                            const browserFrame = document.getElementById('browser-frame');
                            if (browserFrame && (!browserFrame.contentWindow || !browserFrame.contentWindow.document.body)) {
                                console.log('Page not loaded, trying to refresh');
                                navigateToUrl(url);
                            }
                        }, 5000);
                    }, 500);
                }

            }
        }
    }

    // Other workspace event handling remains unchanged
    // Editor related events
    else if (result.includes('file saved') || result.includes('.py') ||
        result.includes('.js') || result.includes('.html') ||
        result.includes('.css') || result.includes('.json')) {
        activateWorkspaceTab('editor');
        updateCodeEditor(result);
    }
    // Terminal related events
    else if (result.includes('$ ') || result.includes('command') ||
        result.includes('executed') || type === 'run') {
        activateWorkspaceTab('terminal');
        addTerminalOutput(result);
    }
    // File operation related events
    else if (result.includes('file') || result.includes('directory') ||
        result.includes('folder') || result.includes('created')) {
        activateWorkspaceTab('files');
        updateFileExplorer(result);
    }
}

// Function to navigate browser to URL
function navigateToUrl(url) {
    console.log('Navigating to URL:', url);
    const browserContainer = document.querySelector('.browser-container');
    const taskBrowserView = browserContainer.querySelector('.task-browser-view');
    const urlDisplay = browserContainer.querySelector('.task-browser-url');

    if (!browserContainer || !taskBrowserView) {
        console.error('Browser container not found');
        return;
    }

    // Update URL display
    if (urlDisplay) {
        urlDisplay.textContent = url;
        urlDisplay.title = url;
    }

    // Check if browser frame already exists
    let browserFrame = document.getElementById('browser-frame');
    if (!browserFrame) {
        browserFrame = document.createElement('iframe');
        browserFrame.id = 'browser-frame';
        browserFrame.className = 'task-browser-frame';
        browserFrame.style.width = '100%';
        browserFrame.style.height = '100%';
        browserFrame.style.border = 'none';
        taskBrowserView.innerHTML = '';
        taskBrowserView.appendChild(browserFrame);
    }

    // Add loading status indicator
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'browser-loading-indicator';
    loadingIndicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading page...';
    taskBrowserView.appendChild(loadingIndicator);

    // Set iframe event listeners
    browserFrame.onload = () => {
        console.log('Page loading complete');
        loadingIndicator.remove();
    };

    browserFrame.onerror = () => {
        console.error('Page loading failed');
        loadingIndicator.innerHTML = '<i class="fas fa-exclamation-circle"></i> Page loading failed, please refresh and try again';
    };

    // Set URL
    try {
        browserFrame.src = url;
    } catch (error) {
        console.error('Failed to set URL:', error);
        loadingIndicator.innerHTML = '<i class="fas fa-exclamation-circle"></i> Unable to load page';
    }
}

// Function to update code editor
function updateCodeEditor(content) {
    const codeEditor = document.getElementById('code-editor');
    const filePath = document.querySelector('.file-path');

    if (codeEditor) {
        // Extract file path if present
        const filePathMatch = content.match(/File: ([^\n]+)/);
        if (filePathMatch && filePathMatch[1]) {
            filePath.textContent = filePathMatch[1].trim();
        }

        // Clean up content for display
        let cleanContent = content;
        if (content.includes('```')) {
            // Extract code from markdown code blocks
            const codeMatch = content.match(/```(?:\w+)?\n([\s\S]+?)\n```/);
            if (codeMatch && codeMatch[1]) {
                cleanContent = codeMatch[1];
            }
        }

        codeEditor.textContent = cleanContent;
        // Apply syntax highlighting if needed
        // This would require a library like highlight.js or prism.js
    }
}

// Function to add output to terminal
function addTerminalOutput(content) {
    const terminalOutput = document.getElementById('terminal-output');

    if (terminalOutput) {
        const outputLine = document.createElement('div');
        outputLine.textContent = content;
        terminalOutput.appendChild(outputLine);

        // Auto scroll to bottom
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }
}

// Function to update file explorer
function updateFileExplorer(content) {
    const fileExplorer = document.getElementById('file-explorer');

    if (fileExplorer) {
        // For demonstration purposes, create a simple file list
        // In a real implementation, this would parse the content and update accordingly
        const files = [
            { name: 'index.html', type: 'file' },
            { name: 'styles', type: 'folder' },
            { name: 'scripts', type: 'folder' },
            { name: 'main.js', type: 'file' },
            { name: 'README.md', type: 'file' }
        ];

        fileExplorer.innerHTML = '';
        files.forEach(file => {
            const fileItem = document.createElement('div');
            fileItem.className = `file-item ${file.type === 'folder' ? 'folder-item' : ''}`;

            const icon = document.createElement('span');
            icon.className = 'file-icon';
            icon.innerHTML = file.type === 'folder' ? '<i class="fas fa-folder"></i>' : '<i class="fas fa-file"></i>';

            const name = document.createElement('span');
            name.className = 'file-name';
            name.textContent = file.name;

            fileItem.appendChild(icon);
            fileItem.appendChild(name);

            // Add click event to open files or folders
            fileItem.addEventListener('click', () => {
                if (file.type === 'file') {
                    activateWorkspaceTab('editor');
                    updateCodeEditor(`// Content of ${file.name}`);
                    document.querySelector('.file-path').textContent = file.name;
                }
            });

            fileExplorer.appendChild(fileItem);
        });
    }
}

// Function to activate a specific workspace tab
function activateWorkspaceTab(tabId) {
    // Update active tab state
    activeWorkspaceTab = tabId;

    // Update tab buttons
    document.querySelectorAll('.workspace-tabs .tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        }
    });

    // Update tab content visibility
    document.querySelectorAll('.workspace-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.id === tabId + '-tab') {
            tab.classList.add('active');
        }
    });
}

// Toggle workspace panel display state
function toggleWorkspacePanel() {
    const workspacePanel = document.getElementById('workspace-panel');
    const toggleButton = document.querySelector('.workspace-toggle');

    if (workspacePanel) {
        const isShown = workspacePanel.classList.contains('show');

        if (isShown) {
            workspacePanel.classList.remove('show');
            toggleButton.innerHTML = '<i class="fas fa-columns"></i>';
        } else {
            workspacePanel.classList.add('show');
            toggleButton.innerHTML = '<i class="fas fa-times"></i>';
        }
    }
}

function showWorkspacePanel() {
    const workspacePanel = document.getElementById('workspace-panel');
    const toggleButton = document.querySelector('.workspace-toggle');

    if (workspacePanel) {
        workspacePanel.classList.add('show');
        if (toggleButton) {
            toggleButton.innerHTML = '<i class="fas fa-times"></i>';
        }
    }
}

function hideWorkspacePanel() {
    const workspacePanel = document.getElementById('workspace-panel');
    const toggleButton = document.querySelector('.workspace-toggle');

    if (workspacePanel) {
        workspacePanel.classList.remove('show');
        if (toggleButton) {
            toggleButton.innerHTML = '<i class="fas fa-columns"></i>';
        }
    }
}

function formatStepContent(data, type) {
    // Create ISO formatted timestamp, ensure consistent sorting
    const now = new Date();
    const isoTimestamp = now.toISOString();
    const localTime = now.toLocaleTimeString();

    return {
        formattedContent: data.result || (data.message || JSON.stringify(data)),
        timestamp: localTime,
        isoTimestamp: isoTimestamp // Add ISO formatted timestamp for sorting
    };
}

function createStepElement(type, content, timestamp) {
    const step = document.createElement('div');

    // Executing step
    const stepRegex = /Executing step (\d+)\/(\d+)/;
    if (type === 'log' && stepRegex.test(content)) {
        const match = content.match(stepRegex);
        const currentStep = parseInt(match[1]);
        const totalSteps = parseInt(match[2]);

        step.className = 'step-divider';
        step.innerHTML = `
            <div class="step-circle">${currentStep}</div>
            <div class="step-line"></div>
            <div class="step-info">${currentStep}/${totalSteps}</div>
        `;
    } else if (type === 'act') {
        // Check if it contains information about file saving
        const saveRegex = /Content successfully saved to (.+)/;
        const match = content.match(saveRegex);

        step.className = `step-item ${type}`;
        step.dataset.type = type;
        step.dataset.timestamp = timestamp; // Store timestamp as data attribute

        // Get icon HTML
        const iconHtml = getEventIcon(type);

        if (match && match[1]) {
            const filePath = match[1].trim();
            const fileName = filePath.split('/').pop();
            const fileExtension = fileName.split('.').pop().toLowerCase();

            // Handling different types of files
            let fileInteractionHtml = '';

            if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(fileExtension)) {
                fileInteractionHtml = `
                    <div class="file-interaction image-preview">
                        <img src="${filePath}" alt="${fileName}" class="preview-image" onclick="showFullImage('${filePath}')">
                        <a href="/download?file_path=${filePath}" download="${fileName}" class="download-link">⬇️ 下载图片</a>
                    </div>
                `;
            } else if (['mp3', 'wav', 'ogg'].includes(fileExtension)) {
                fileInteractionHtml = `
                    <div class="file-interaction audio-player">
                        <audio controls src="${filePath}"></audio>
                        <a href="/download?file_path=${filePath}" download="${fileName}" class="download-link">⬇️ 下载音频</a>
                    </div>
                `;
            } else if (['html', 'js', 'py'].includes(fileExtension)) {
                fileInteractionHtml = `
                    <div class="file-interaction code-file">
                        <button onclick="simulateRunPython('${filePath}')" class="run-button">▶️ 模拟运行</button>
                        <a href="/download?file_path=${filePath}" download="${fileName}" class="download-link">⬇️ 下载文件</a>
                    </div>
                `;
            } else {
                fileInteractionHtml = `
                    <div class="file-interaction">
                        <a href="/download?file_path=${filePath}" download="${fileName}" class="download-link">⬇️ 下载文件: ${fileName}</a>
                    </div>
                `;
            }

            step.innerHTML = `
                <div class="log-header" onclick="toggleStepContent(this)">
                    <div class="log-prefix">
                        <span class="log-prefix-icon">${iconHtml}</span>
                        <span>${getEventLabel(type)}</span>
                        <time>${timestamp}</time>
                    </div>
                    <div class="content-preview">${content.substring(0, 20) + (content.length > 20 ? "..." : "")}</div>
                    <div class="step-controls">
                        <span class="minimize-btn" onclick="minimizeStep(event, this)"></span>
                    </div>
                </div>
                <div class="log-body">
                    <div class="log-content">
                        <pre>${content}</pre>
                        ${fileInteractionHtml}
                    </div>
                </div>
            `;
        } else {
            step.innerHTML = `
                <div class="log-header" onclick="toggleStepContent(this)">
                    <div class="log-prefix">
                        <span class="log-prefix-icon">${iconHtml}</span>
                        <span>${getEventLabel(type)}</span>
                        <time>${timestamp}</time>
                    </div>
                    <div class="content-preview">${content.substring(0, 20) + (content.length > 20 ? "..." : "")}</div>
                    <div class="step-controls">
                        <span class="minimize-btn" onclick="minimizeStep(event, this)"></span>
                    </div>
                </div>
                <div class="log-body">
                    <div class="log-content">
                        <pre>${content}</pre>
                    </div>
                </div>
            `;
        }
    } else {
        // Get content preview
        let contentPreview = "";
        if (type === 'think' && content.length > 0) {
            // Extract the first 30 characters of the thinking content as preview
            contentPreview = content.substring(0, 30) + (content.length > 30 ? "..." : "");
        } else if (type === 'tool' && content.includes('selected')) {
            // Tool selection content remains as is
            contentPreview = content;
        } else if (type === 'log') {
            // Log content remains as is, usually short
            contentPreview = content;
        } else {
            // Other types take the first 20 characters
            contentPreview = content.substring(0, 20) + (content.length > 20 ? "..." : "");
        }

        step.className = `step-item ${type}`;
        step.dataset.type = type;
        step.dataset.timestamp = timestamp; // Store timestamp as data attribute

        // Get icon HTML
        const iconHtml = getEventIcon(type);

        // Ensure timestamp is displayed in log-prefix, and wrap step type label in span tag
        step.innerHTML = `
            <div class="log-header" onclick="toggleStepContent(this)">
                <div class="log-prefix">
                    <span class="log-prefix-icon">${iconHtml}</span>
                    <span>${getEventLabel(type)}</span>
                    <time>${timestamp}</time>
                </div>
                <div class="content-preview">${contentPreview}</div>
                <div class="step-controls">
                    <span class="minimize-btn" onclick="minimizeStep(event, this)"></span>
                </div>
            </div>
            <div class="log-body">
                <div class="log-content">
                    <pre>${content}</pre>
                </div>
            </div>
        `;
    }

    return step;
}

// Toggle display/hide of step content
function toggleStepContent(header) {
    const stepItem = header.closest('.step-item');
    if (!stepItem) return;

    const logBody = stepItem.querySelector('.log-body');
    if (!logBody) return;

    // Close other expanded steps
    document.querySelectorAll('.step-item.expanded').forEach(item => {
        if (item !== stepItem) {
            item.classList.remove('expanded');
        }
    });

    // Toggle current step expanded state
    stepItem.classList.toggle('expanded');

    // Highlight current step
    highlightStep(stepItem);

    // Trigger layout adjustment
    handleResponsiveLayout();
}

// Minimize step without toggling expansion
function minimizeStep(event, btn) {
    event.stopPropagation(); // Prevent event bubbling

    const stepItem = btn.closest('.step-item');
    if (!stepItem) return;

    stepItem.classList.remove('expanded');

    // Trigger layout adjustment
    handleResponsiveLayout();
}

function highlightStep(stepElement) {
    // Remove other steps highlight
    document.querySelectorAll('.step-item').forEach(item => {
        item.classList.remove('active');
    });

    // Add current step highlight
    stepElement.classList.add('active');

    // Update current step information to result panel
    const currentStep = document.getElementById('current-step');
    if (currentStep) {
        const type = stepElement.dataset.type;
        currentStep.setAttribute('data-type', type);
    }
}

// Toggle history panel display state
function toggleHistory() {
    const historyPanel = document.querySelector('.history-panel');
    const overlay = document.querySelector('.overlay');
    const historyToggle = document.querySelector('.history-toggle');
    const container = document.querySelector('.container');

    if (historyVisible) {
        // Hide history
        historyPanel.classList.remove('show');
        overlay.classList.remove('show');
        historyToggle.classList.remove('active');
        container.classList.remove('with-history');
    } else {
        // Show history
        historyPanel.classList.add('show');
        overlay.classList.add('show');
        historyToggle.classList.add('active');
        container.classList.add('with-history');
    }

    historyVisible = !historyVisible;
}

// Close history panel on small screens
function closeHistoryOnMobile() {
    if (historyVisible) {
        toggleHistory();
    }
}

// Comprehensive function to handle responsive layout
function handleResponsiveLayout() {
    const container = document.querySelector('.container');
    const workspacePanel = document.getElementById('workspace-panel');
    const mainPanel = document.querySelector('.main-panel');
    const stepsPanel = document.querySelector('.steps-panel');
    const isMobile = window.innerWidth <= 768;
    const isTablet = window.innerWidth > 768 && window.innerWidth <= 1200;
    const isDesktop = window.innerWidth > 1200;

    // 设置响应式布局的设备类型标识
    document.body.classList.remove('is-mobile', 'is-tablet', 'is-desktop');
    if (isMobile) {
        document.body.classList.add('is-mobile');
    } else if (isTablet) {
        document.body.classList.add('is-tablet');
    } else {
        document.body.classList.add('is-desktop');
    }

    // 确保可滚动容器始终可滚动
    const stepsContainer = document.getElementById('steps-container');
    if (stepsContainer) {
        stepsContainer.style.overflowY = 'auto';
        stepsContainer.style.overflowX = 'hidden';
    }

    // 移动设备布局调整
    if (isMobile) {
        // 在移动设备上隐藏步骤面板
        if (stepsPanel) {
            stepsPanel.style.display = 'none';
        }

        // 调整工作区面板和主面板，保持一致的高度
        if (workspacePanel && mainPanel) {
            workspacePanel.style.width = '100%';
            mainPanel.style.width = '100%';

            // 两个面板使用相同的高度
            workspacePanel.style.height = 'auto';
            mainPanel.style.height = 'auto';
            workspacePanel.style.minHeight = '500px';
            mainPanel.style.minHeight = '500px';
        }
    } else {
        // 平板和桌面设备布局
        if (stepsPanel) {
            stepsPanel.style.display = isDesktop ? 'block' : 'none';
        }

        // 在桌面设备上，让工作区和主面板高度一致
        if (workspacePanel && mainPanel) {
            // 对于低高度设备使用特殊处理
            if (window.innerHeight <= 700) {
                const height = `calc(100vh - 60px)`;
                workspacePanel.style.height = height;
                mainPanel.style.height = height;
            } else if (isDesktop) {
                const height = `calc(100vh - 80px)`;
                workspacePanel.style.height = height;
                mainPanel.style.height = height;
            }
        }
    }

    // 确保工作区面板可见
    if (workspacePanel) {
        workspacePanel.style.display = 'flex';
        workspacePanel.style.flexDirection = 'column';
    }

    // 设置容器宽度
    if (isDesktop) {
        container.style.width = 'min(1800px, 98%)';
    } else {
        container.style.width = '98%';
    }

    // 确保容器具有正确的布局类
    if (workspacePanel && !workspacePanel.classList.contains('hidden')) {
        container.classList.add('with-workspace');

        // 在移动设备和平板上调整布局方向
        if (isMobile || isTablet) {
            container.style.flexDirection = 'column';
        } else {
            container.style.flexDirection = 'row';
        }
    } else {
        container.classList.remove('with-workspace');
    }

    // 调整历史面板在移动设备上的宽度
    const historyPanel = document.querySelector('.history-panel');
    if (historyPanel) {
        if (isMobile) {
            historyPanel.style.width = '100%';
        } else {
            historyPanel.style.width = '280px';
        }
    }

    // 调整输入框和发送按钮在移动设备上的布局
    const inputContainer = document.querySelector('.input-container');
    if (inputContainer) {
        if (isMobile) {
            inputContainer.style.flexDirection = 'column';
            inputContainer.style.padding = '10px';
        } else {
            inputContainer.style.flexDirection = 'row';
            inputContainer.style.padding = '15px';
        }
    }
}

// Prevent page scrolling in certain areas
function preventPageScroll() {
    // 在大屏设备上，防止某些容器的内部滚动影响整个页面滚动
    const isDesktop = window.innerWidth > 1200;

    if (isDesktop) {
        const containers = [
            document.querySelector('.task-browser-view'),
            document.querySelector('.terminal-output'),
            document.querySelector('.code-editor'),
            document.querySelector('.file-explorer')
        ];

        containers.forEach(container => {
            if (container) {
                container.addEventListener('wheel', (e) => {
                    if (container.scrollHeight > container.clientHeight) {
                        e.stopPropagation();
                    }
                });
            }
        });
    }
}

// 调整输入容器的响应式布局
function adjustInputContainer() {
    const inputContainer = document.querySelector('.input-container');
    const promptInput = document.getElementById('prompt-input');
    const sendBtn = document.querySelector('.send-btn');
    const isMobile = window.innerWidth <= 768;

    if (!inputContainer || !promptInput || !sendBtn) return;

    if (isMobile) {
        // 移动设备布局
        inputContainer.style.flexDirection = 'column';
        inputContainer.style.padding = '10px';
        promptInput.style.width = '100%';
        promptInput.style.marginBottom = '10px';
        sendBtn.style.width = '100%';
    } else {
        // 桌面设备布局
        inputContainer.style.flexDirection = 'row';
        inputContainer.style.padding = '15px';
        promptInput.style.width = '';
        promptInput.style.marginBottom = '0';
        sendBtn.style.width = 'auto';
    }
}

// Handle window resize
function handleWindowResize() {
    const container = document.querySelector('.container');
    const workspacePanel = document.getElementById('workspace-panel');

    // 根据屏幕宽度决定布局
    const isMobile = window.innerWidth <= 768;

    // 确保工作区在窗口大小变化时保持正确布局
    if (workspacePanel) {
        workspacePanel.classList.remove('hidden');
        if (workspacePanel.style.display !== 'flex') {
            workspacePanel.style.display = 'flex';
            workspacePanel.style.flexDirection = 'column';
        }

        // 在移动设备上调整工作区宽度
        if (isMobile) {
            workspacePanel.style.width = '100%';
        } else {
            workspacePanel.style.width = '';  // 使用CSS中定义的默认值
        }

        container.classList.add('with-workspace');
    }

    // 调用布局处理函数
    handleResponsiveLayout();

    // 调整浏览器页面和终端高度
    adjustBrowserHeight();

    // 调整输入容器
    adjustInputContainer();
}

// 调整浏览器视图和终端高度
function adjustBrowserHeight() {
    const browserContainer = document.querySelector('.browser-container');
    const terminalContainer = document.querySelector('.terminal-container');
    const taskBrowserContainer = document.querySelector('.task-browser-container');
    const isMobile = window.innerWidth <= 768;
    const isTablet = window.innerWidth > 768 && window.innerWidth <= 1200;
    const isLowHeight = window.innerHeight <= 700;
    const isVeryLowHeight = window.innerHeight <= 500;
    const workspacePanel = document.getElementById('workspace-panel');

    // 根据工作区容器高度和设备类型计算内容容器高度
    const calculateHeight = () => {
        if (workspacePanel) {
            // 考虑工作区面板的实际高度
            const workspacePanelHeight = workspacePanel.offsetHeight;
            const headerHeight = isLowHeight ? 50 : 60; // 对于低高度设备，减少标题栏高度估计值
            return (workspacePanelHeight - headerHeight) + 'px';
        }

        // 如果没有工作区面板，根据屏幕尺寸返回默认值
        if (isVeryLowHeight) {
            return '300px';
        } else if (isLowHeight) {
            return '400px';
        } else if (isMobile) {
            return '350px';
        } else if (isTablet) {
            return '450px';
        } else {
            return '600px';
        }
    };

    const containerHeight = calculateHeight();

    // 设置各种容器的高度
    [browserContainer, taskBrowserContainer].forEach(container => {
        if (container) {
            container.style.height = containerHeight;
        }
    });

    if (terminalContainer) {
        terminalContainer.style.height = containerHeight;
    }

    // 调整浏览器视图区域高度
    const taskBrowserView = document.querySelector('.task-browser-view');
    if (taskBrowserView && taskBrowserContainer) {
        // 对于非常低的高度设备，减少头部和底部的估计高度
        const headerFooterHeight = isVeryLowHeight ? 70 : 80;
        taskBrowserView.style.height = `calc(${containerHeight} - ${headerFooterHeight}px)`;
    }
}

// Initialize interface
function initializeInterface() {
    // Check configuration status
    checkConfigStatus();

    // Add history toggle logic
    const historyToggle = document.querySelector('.history-toggle');
    if (historyToggle) {
        historyToggle.addEventListener('click', toggleHistory);
    }

    // Add overlay click to close history
    const overlay = document.querySelector('.overlay');
    if (overlay) {
        overlay.addEventListener('click', toggleHistory);
    }

    // Set up workspace tab switching
    document.querySelectorAll('.workspace-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            if (tabId) {
                activateWorkspaceTab(tabId);
            }
        });
    });

    // Set up browser navigation
    const urlInput = document.querySelector('.url-input');
    const browserAction = document.querySelector('.browser-action');
    if (urlInput && browserAction) {
        browserAction.addEventListener('click', () => {
            navigateToUrl(urlInput.value);
        });

        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                navigateToUrl(urlInput.value);
            }
        });
    }

    // Set up terminal input
    const terminalInput = document.getElementById('terminal-input');
    if (terminalInput) {
        terminalInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const command = terminalInput.value;
                addTerminalOutput(`$ ${command}`);
                addTerminalOutput(`Executing: ${command}`);
                terminalInput.value = '';
            }
        });
    }

    // Bind input box events
    const promptInput = document.getElementById('prompt-input');
    if (promptInput) {
        promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                createTask();
            }
        });
    }

    // Add window resize event listener
    window.addEventListener('resize', handleWindowResize);

    // Add keyboard event listener for closing modal
    document.addEventListener('keydown', handleKeyboardEvents);

    // Prevent page scrolling
    preventPageScroll();

    // Set initial layout
    setupInitialLayout();

    // Load history tasks
    loadHistory();

    // Ensure workspace is visible
    showWorkspacePanel();

    // 设置窗口调整大小事件
    window.addEventListener('resize', handleWindowResize);

    // 设置初始布局
    setupInitialLayout();

    // 添加设备类型检测
    detectDeviceType();

    // 添加设备方向变化检测
    window.addEventListener('orientationchange', handleOrientationChange);
}

// Handle keyboard events
function handleKeyboardEvents(e) {
    // ESC key close history panel and modal
    if (e.key === 'Escape') {
        if (historyVisible) {
            toggleHistory();
        }

        const imageModal = document.getElementById('image-modal');
        if (imageModal && imageModal.classList.contains('active')) {
            imageModal.classList.remove('active');
        }

        const pythonModal = document.getElementById('python-modal');
        if (pythonModal && pythonModal.classList.contains('active')) {
            pythonModal.classList.remove('active');
        }
    }
}
// Set initial layout
function setupInitialLayout() {
    // 初始化历史面板状态
    const historyPanel = document.querySelector('.history-panel');
    if (historyPanel) {
        historyPanel.classList.remove('show');
    }

    // 确保工作区面板可见
    const workspacePanel = document.getElementById('workspace-panel');
    if (workspacePanel) {
        workspacePanel.classList.remove('hidden');
        workspacePanel.style.display = 'flex';
        workspacePanel.style.flexDirection = 'column';
    }

    // 手动触发一次布局处理
    handleResponsiveLayout();

    // 调整输入容器
    adjustInputContainer();
}

// When document load complete initialize interface
document.addEventListener('DOMContentLoaded', initializeInterface);

// Function to load task history
function loadHistory() {
    fetch('/tasks')
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(`Request failed: ${response.status} - ${text.substring(0, 100)}`);
                });
            }
            return response.json();
        })
        .then(tasks => {
            const listContainer = document.getElementById('task-list');
            if (tasks.length === 0) {
                listContainer.innerHTML = '<div class="info">No history tasks</div>';
                return;
            }

            // Update history count
            const historyCount = document.querySelector('.history-count');
            if (historyCount) {
                historyCount.textContent = tasks.length;
            }

            listContainer.innerHTML = tasks.map(task => `
            <div class="task-card" data-task-id="${task.id}" onclick="loadTask('${task.id}')">
                <div class="task-title">${task.prompt}</div>
                <div class="task-meta">
                    <span>${new Date(task.created_at).toLocaleString()}</span>
                    <span class="status status-${task.status ? task.status.toLowerCase() : 'unknown'}">
                        ${getStatusText(task.status)}
                    </span>
                </div>
            </div>
        `).join('');
        })
        .catch(error => {
            console.error('Failed to load history:', error);
            const listContainer = document.getElementById('task-list');
            listContainer.innerHTML = `<div class="error">Loading failed: ${error.message}</div>`;
        });
}
// Function to load a specific task
function loadTask(taskId) {
    if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
    }

    const taskContainer = document.getElementById('task-container');
    const stepsContainer = document.getElementById('steps-container');

    // 确保工作区保持显示
    showWorkspacePanel();

    // Hide welcome message
    const welcomeMessage = taskContainer.querySelector('.welcome-message');
    if (welcomeMessage) {
        welcomeMessage.style.display = 'none';
    }
    stepsContainer.innerHTML = '<div class="loading">Loading task...</div>';

    // Close history panel on mobile devices
    closeHistoryOnMobile();

    fetch(`/tasks/${taskId}`)
        .then(response => response.json())
        .then(task => {
            // Highlight currently selected task card
            highlightTaskCard(taskId);

            stepsContainer.innerHTML = '';
            if (task.steps && task.steps.length > 0) {
                // Sort and render steps by timestamp
                renderSortedSteps(task.steps, task.created_at);
            } else {
                stepsContainer.innerHTML = '<div class="info">No steps recorded for this task</div>';
            }

            updateTaskStatus(task);

            // 确保工作区始终可见
            showWorkspacePanel();
        })
        .catch(error => {
            stepsContainer.innerHTML = `<div class="error">Error: ${error.message}</div>`;
            console.error('Failed to load task:', error);
        });
}

// Highlight currently selected task card
function highlightTaskCard(taskId) {
    const taskCards = document.querySelectorAll('.task-card');
    taskCards.forEach(card => {
        card.classList.remove('active');
        if (card.getAttribute('data-task-id') === taskId) {
            card.classList.add('active');
        }
    });
}
// Sort and render steps by timestamp
function renderSortedSteps(steps, taskCreatedAt) {
    const stepsContainer = document.getElementById('steps-container');

    // Store steps collection
    let taskSteps = [];

    steps.forEach((step, index) => {
        const stepTimestamp = new Date(step.created_at || taskCreatedAt).toLocaleTimeString();
        const stepElement = createStepElement(
            step.type,
            step.result,
            stepTimestamp
        );

        // Add steps to collection
        taskSteps.push({
            index: index,
            timestamp: stepTimestamp,
            isoTimestamp: step.created_at || taskCreatedAt, // Save ISO timestamp
            element: stepElement,
            step: step
        });
    });

    // Sort steps by timestamp
    taskSteps.sort((a, b) => {
        // Try using ISO timestamp for comparison
        if (a.isoTimestamp && b.isoTimestamp) {
            return new Date(a.isoTimestamp) - new Date(b.isoTimestamp);
        }

        // First sort by timestamp, if time is the same, sort by index
        const timeCompare = new Date(a.timestamp) - new Date(b.timestamp);
        return timeCompare !== 0 ? timeCompare : a.index - b.index;
    });

    // Add sorted steps to container
    taskSteps.forEach((stepData, index) => {
        // Only set last step to expanded state
        if (index === taskSteps.length - 1) {
            stepData.element.classList.add('expanded');
            stepData.element.classList.add('active');
        }

        stepsContainer.appendChild(stepData.element);
    });
}

// Function to scroll container to bottom
function autoScroll(element) {
    if (element) {
        element.scrollTop = element.scrollHeight;
    }
}

// Get status text for display
function getStatusText(status) {
    switch (status) {
        case 'pending': return 'Pending';
        case 'running': return 'Running';
        case 'completed': return 'Completed';
        case 'failed': return 'Failed';
        default: return 'Unknown';
    }
}

function handleEvent(event, type) {
    if (type === 'think') {
        expandThinkingContent(event);
    } else if (type === 'tool') {
        handleToolEvents(event);

        // Detect browser related events
        if (event.result && typeof event.result === 'string') {
            const result = event.result.toLowerCase();
            if (result.includes('browser') || result.includes('playwright')) {
                if (event.taskId) {
                    currentTaskId = event.taskId;
                }
                if (!isTaskBrowserOpen && currentTaskId) {
                    // 延迟打开浏览器，确保其他UI元素已经准备好
                    setTimeout(() => {
                        openTaskBrowser();
                    }, 1000);
                }
            }
        }
    } else if (type === 'error') {
        handleErrorEvents(event);
    } else if (type === 'complete') {
        handleCompletionEvents(event);
    } else if (type === 'update') {
        handleUpdateEvents(event);
    }
}

function openTaskBrowser() {
    if (!currentTaskId) {
        console.error('No active task');
        alert('No active task, please create a task that uses the browser first');
        return;
    }

    console.log('View current task browser:', currentTaskId);
    isTaskBrowserOpen = true;

    // Switch to browser tab
    activateWorkspaceTab('browser');

    // Show workspace panel
    showWorkspacePanel();

    // Get browser container
    const browserContainer = document.querySelector('.browser-container');
    if (!browserContainer) {
        console.error('Browser container element not found');
        return;
    }

    // Ensure browser container is visible
    browserContainer.style.display = 'block';
    browserContainer.style.visibility = 'visible';
    browserContainer.style.opacity = '1';

    // Connect to task browser
    connectToTaskBrowser(currentTaskId, browserContainer);
}
// Connect to task browser
function connectToTaskBrowser(taskId, container) {
    if (!taskId) {
        console.error('No valid task ID provided');
        return;
    }

    // Show connecting status
    container.innerHTML = `
        <div class="task-browser-connecting">
            <div class="connecting-status">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Connecting to task browser...</span>
            </div>
            <div class="task-id">
                <i class="fas fa-link"></i>
                <span>${taskId}</span>
            </div>
        </div>
    `;

    // Ensure container is visible
    container.style.display = 'block';
    container.style.visibility = 'visible';
    container.style.opacity = '1';

    // First check if the task has a browser session
    fetch(`/api/tasks/${taskId}/browser`)
        .then(response => {
            if (!response.ok) {
                throw new Error('This task has no available browser session');
            }
            return response.json();
        })
        .then(data => {
            console.log('Successfully retrieved task browser information:', data);

            // Create browser view interface
            createTaskBrowserInterface(container, taskId);

            // Connect to WebSocket to get real-time content
            connectToTaskBrowserWebSocket(taskId);
        })
        .catch(error => {
            console.error('Error getting task browser information:', error);
            container.innerHTML = `
                <div class="task-browser-error">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>${error.message || 'Unable to connect to task browser'}</p>
                    <p class="error-hint">The task may not be using a browser or the browser has been closed</p>
                    <button onclick="openTaskBrowser()">Retry</button>
                </div>
            `;
        });
}

// Create task browser interface
function createTaskBrowserInterface(container, taskId) {
    container.innerHTML = `
        <div class="task-browser-container">
            <div class="task-browser-header">
                <div class="task-browser-title">Task Browser</div>
                <div class="task-browser-url">Connecting...</div>
                <div class="task-browser-actions">
                    <button class="refresh-browser-btn" onclick="refreshTaskBrowser('${taskId}')" title="Refresh">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>
            </div>
            <div class="task-browser-view">
                <div class="task-browser-loading">
                    <i class="fas fa-spinner fa-spin"></i> Loading browser content...
                </div>
            </div>
            <div class="task-browser-status">Connecting...</div>
        </div>
    `;
}

// Connect to task browserWebSocket
function connectToTaskBrowserWebSocket(taskId) {
    // Close existing connection
    if (window.taskBrowserWebSocket) {
        window.taskBrowserWebSocket.close();
        window.taskBrowserWebSocket = null;
    }

    // Establish new connection
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/tasks/${taskId}/browser`;

    console.log('Connecting to task browser WebSocket:', wsUrl);
    window.taskBrowserWebSocket = new WebSocket(wsUrl);

    // Handle connection open
    window.taskBrowserWebSocket.onopen = function () {
        console.log('Task browser WebSocket connection opened');
        updateTaskBrowserStatus('Connected to task browser');
    };

    // Handle received messages
    window.taskBrowserWebSocket.onmessage = function (event) {
        const data = JSON.parse(event.data);

        if (data.error) {
            console.error('WebSocket error:', data.error);
            updateTaskBrowserStatus(`Error: ${data.error}`);
            return;
        }

        // Handle different types of messages
        switch (data.type) {
            case 'screenshot':
                updateTaskBrowserScreenshot(data.data);
                break;
            case 'title':
                updateTaskBrowserTitle(data.data);
                break;
            case 'url':
                updateTaskBrowserUrl(data.data);
                break;
            case 'state':
                // 保存浏览器状态信息供滚动指示器使用
                try {
                    if (data.data) {
                        window.lastBrowserState = JSON.parse(data.data);
                        console.log('Browser state updated:', window.lastBrowserState);
                    }
                } catch (e) {
                    console.error('Error parsing browser state:', e);
                }
                break;
            default:
                console.log('Received unknown type of task browser message:', data);
        }
    };

    // Handle connection close
    window.taskBrowserWebSocket.onclose = function () {
        console.log('Task browser WebSocket connection closed');
        updateTaskBrowserStatus('Connection closed');
    };

    // Handle errors
    window.taskBrowserWebSocket.onerror = function (error) {
        console.error('Task browser WebSocket error:', error);
        updateTaskBrowserStatus('Connection error');
    };
}
// Update task browser status
function updateTaskBrowserStatus(message) {
    const statusElement = document.querySelector('.task-browser-status');
    if (statusElement) {
        statusElement.textContent = message;
    }
}

// Update task browser screenshot
function updateTaskBrowserScreenshot(base64Image) {
    const container = document.querySelector('.task-browser-view');
    if (!container) return;

    // Ensure img element exists
    let img = container.querySelector('.task-browser-image');
    if (!img) {
        img = document.createElement('img');
        img.className = 'task-browser-image';
        img.alt = 'Task browser content';
        container.innerHTML = '';
        container.appendChild(img);
    }

    // Update image source
    img.src = `data:image/jpeg;base64,${base64Image}`;

    // 添加滚动指示器
    try {
        if (window.lastBrowserState && window.lastBrowserState.scroll_info &&
            window.lastBrowserState.scroll_info.current_position > 0) {

            let scrollIndicator = container.querySelector('.scroll-position-indicator');
            if (!scrollIndicator) {
                scrollIndicator = document.createElement('div');
                scrollIndicator.className = 'scroll-position-indicator';
                container.appendChild(scrollIndicator);
            }

            // 更新滚动指示器内容
            const position = window.lastBrowserState.scroll_info.current_position;
            const totalHeight = window.lastBrowserState.scroll_info.total_height;
            const percentage = totalHeight > 0 ? Math.round((position / totalHeight) * 100) : 0;

            scrollIndicator.textContent = `滚动位置: ${position}px (${percentage}%)`;
            scrollIndicator.style.position = 'absolute';
            scrollIndicator.style.top = '10px';
            scrollIndicator.style.right = '10px';
            scrollIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            scrollIndicator.style.color = 'white';
            scrollIndicator.style.padding = '5px 10px';
            scrollIndicator.style.borderRadius = '5px';
            scrollIndicator.style.fontSize = '12px';
            scrollIndicator.style.zIndex = '1000';
        }
    } catch (e) {
        console.error('Error updating scroll indicator:', e);
    }
}

// Update task browser title
function updateTaskBrowserTitle(title) {
    const titleElement = document.querySelector('.task-browser-title');
    if (titleElement) {
        titleElement.textContent = title || 'Task Browser';
    }
}

// Update task browser URL
function updateTaskBrowserUrl(url) {
    const urlElement = document.querySelector('.task-browser-url');
    if (urlElement) {
        urlElement.textContent = url || '';
        urlElement.title = url || '';
    }
}

// Refresh task browser
function refreshTaskBrowser(taskId) {
    if (!taskId && currentTaskId) {
        taskId = currentTaskId;
    }

    if (!taskId) {
        console.error('Cannot refresh, no active task ID');
        return;
    }

    // Reconnect to task browser
    const browserContainer = document.querySelector('.browser-container');
    if (browserContainer) {
        connectToTaskBrowser(taskId, browserContainer);
    }
}

// Initialize task browser functionality
document.addEventListener('DOMContentLoaded', function () {
    console.log('DOM loaded, initializing task browser...');
});

function handleToolEvents(event) {
    // Check if there are results
    if (!event || !event.result) return;

    try {
        // Process tool event results
        const content = event.result;
        console.log('Processing tool event:', content);

        // Create tool output element
        const toolElement = document.createElement('div');
        toolElement.className = 'tool-content';

        // 优化JSON格式化逻辑
        if (typeof content === 'object') {
            try {
                toolElement.innerHTML = `<pre>${JSON.stringify(content, null, 2)}</pre>`;
            } catch (e) {
                toolElement.textContent = String(content);
                console.error('Error formatting tool result:', e);
            }
        } else {
            toolElement.textContent = content;
        }

        // Add to steps container
        const stepsContainer = document.getElementById('steps-container');
        if (stepsContainer) {
            const lastStep = stepsContainer.querySelector('.step-item:last-child');
            if (lastStep) {
                const logBody = lastStep.querySelector('.log-body');
                if (logBody) {
                    const logContent = logBody.querySelector('.log-content');
                    if (logContent) {
                        logContent.appendChild(toolElement);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error handling tool event:', e);
    }
}

function handleErrorEvents(event) {
    console.error('Error event:', event);
    if (event && event.message) {
        updateTaskStatus({ status: 'failed', error: event.message });
    }
}

function handleCompletionEvents(event) {
    console.log('Complete event:', event);
    // 完成事件通过updateTaskStatus统一处理，不需要额外逻辑
}

function handleUpdateEvents(event) {
    console.log('Update event:', event);
}

function expandThinkingContent(event) {
    console.log('Think event:', event);
}

// 检测设备类型并添加相应的CSS类
function detectDeviceType() {
    const width = window.innerWidth;
    const isMobile = width <= 768;
    const isTablet = width > 768 && width <= 1200;
    const isDesktop = width > 1200;

    document.body.classList.remove('is-mobile', 'is-tablet', 'is-desktop');

    if (isMobile) {
        document.body.classList.add('is-mobile');
    } else if (isTablet) {
        document.body.classList.add('is-tablet');
    } else {
        document.body.classList.add('is-desktop');
    }
}

// 处理设备方向变化
function handleOrientationChange() {
    // 短暂延迟确保浏览器完成方向变化后再更新布局
    setTimeout(() => {
        handleWindowResize();
        adjustBrowserHeight();
    }, 300);
}

function getEventIcon(type) {
    switch (type) {
        case 'think': return '<i class="fas fa-brain"></i>';
        case 'tool': return '<i class="fas fa-cog"></i>';
        case 'act': return '<i class="fas fa-wave-square"></i>';
        case 'log': return '<i class="fas fa-file-alt"></i>';
        case 'run': return '<i class="fas fa-play"></i>';
        case 'message': return '<i class="fas fa-comment"></i>';
        case 'complete': return '<i class="fas fa-check"></i>';
        case 'error': return '<i class="fas fa-times"></i>';
        default: return '<i class="fas fa-thumbtack"></i>';
    }
}

function getEventLabel(type) {
    switch (type) {
        case 'think': return 'Thinking';
        case 'tool': return 'Using Tool';
        case 'act': return 'Taking Action';
        case 'log': return 'Log';
        case 'run': return 'Running';
        case 'message': return 'Message';
        case 'complete': return 'Completed';
        case 'error': return 'Error';
        default: return 'Step';
    }
}

function updateTaskStatus(task) {
    // Create or find status container
    let statusBar = document.getElementById('status-bar');
    if (!statusBar) {
        statusBar = document.createElement('div');
        statusBar.id = 'status-bar';
        statusBar.style.padding = '10px';
        statusBar.style.marginTop = '10px';
        statusBar.style.borderRadius = '4px';
        statusBar.style.fontSize = '14px';
    }

    if (task.status === 'completed') {
        statusBar.className = 'status-complete';
        statusBar.innerHTML = `✅ Task completed`;

        if (currentEventSource) {
            currentEventSource.close();
            currentEventSource = null;
        }
    } else if (task.status === 'failed') {
        statusBar.className = 'status-error';
        statusBar.innerHTML = `❌ ${task.error || 'Task failed'}`;

        if (currentEventSource) {
            currentEventSource.close();
            currentEventSource = null;
        }
    } else {
        statusBar.className = 'status-running';
        statusBar.innerHTML = `⚙️ Task running: ${task.status}`;
    }

    // Find existing status bar to replace, or add to steps container
    const stepsContainer = document.getElementById('steps-container');
    const existingStatus = document.getElementById('status-bar');

    if (existingStatus && existingStatus !== statusBar) {
        existingStatus.parentNode.replaceChild(statusBar, existingStatus);
    } else if (stepsContainer && !existingStatus) {
        stepsContainer.appendChild(statusBar);
    }
}

function showFullImage(imageSrc) {
    const modal = document.getElementById('image-modal');
    if (!modal) {
        const modalDiv = document.createElement('div');
        modalDiv.id = 'image-modal';
        modalDiv.className = 'image-modal';
        modalDiv.innerHTML = `
            <span class="close-modal">&times;</span>
            <img src="${imageSrc}" class="modal-content" id="full-image">
        `;
        document.body.appendChild(modalDiv);

        const closeBtn = modalDiv.querySelector('.close-modal');
        closeBtn.addEventListener('click', () => {
            modalDiv.classList.remove('active');
        });

        modalDiv.addEventListener('click', (e) => {
            if (e.target === modalDiv) {
                modalDiv.classList.remove('active');
            }
        });

        setTimeout(() => modalDiv.classList.add('active'), 10);
    } else {
        document.getElementById('full-image').src = imageSrc;
        modal.classList.add('active');
    }
}

function simulateRunPython(filePath) {
    let modal = document.getElementById('python-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'python-modal';
        modal.className = 'python-modal';
        modal.innerHTML = `
            <div class="python-console">
                <div class="close-modal">&times;</div>
                <div class="python-output">Loading Python file contents...</div>
            </div>
        `;
        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('.close-modal');
        closeBtn.addEventListener('click', () => {
            modal.classList.remove('active');
        });
    }

    modal.classList.add('active');

    // Load Python file content
    fetch(filePath)
        .then(response => response.text())
        .then(code => {
            const outputDiv = modal.querySelector('.python-output');
            outputDiv.innerHTML = '';

            const codeElement = document.createElement('pre');
            codeElement.textContent = code;
            codeElement.style.marginBottom = '20px';
            codeElement.style.padding = '10px';
            codeElement.style.borderBottom = '1px solid #444';
            outputDiv.appendChild(codeElement);

            // Add simulation run results
            const resultElement = document.createElement('div');
            resultElement.innerHTML = `
                <div style="color: #4CAF50; margin-top: 10px; margin-bottom: 10px;">
                    > Simulated operation output:</div>
                <pre style="color: #f8f8f8;">
#This is the result of Python code simulation run
#The actual operational results may vary

# Running ${filePath.split('/').pop()}...
print("Hello from Python Simulated environment!")

# Code execution completed
</pre>
            `;
            outputDiv.appendChild(resultElement);
        })
        .catch(error => {
            console.error('Error loading Python file:', error);
            const outputDiv = modal.querySelector('.python-output');
            outputDiv.innerHTML = `Error loading file: ${error.message}`;
        });
}

function checkConfigStatus() {
    fetch('/config/status')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'missing') {
                showConfigModal(data.example_config);
            } else if (data.status === 'no_example') {
                alert('Error: Missing configuration example file! Please ensure that the config/config.example.toml file exists.');
            } else if (data.status === 'error') {
                alert('Configuration check error:' + data.message);
            }
        })
        .catch(error => {
            console.error('Configuration check failed:', error);
        });
}

// Display configuration pop-up and fill in sample configurations
function showConfigModal(exampleConfig) {
    const configModal = document.getElementById('config-modal');
    if (!configModal) return;

    configModal.classList.add('active');

    if (exampleConfig) {
        fillConfigForm(exampleConfig);
    }

    const saveButton = document.getElementById('save-config-btn');
    if (saveButton) {
        saveButton.onclick = saveConfig;
    }
}

// Use example configuration to fill in the form
function fillConfigForm(exampleConfig) {
    if (exampleConfig.llm) {
        const llm = exampleConfig.llm;

        setInputValue('llm-model', llm.model);
        setInputValue('llm-base-url', llm.base_url);
        setInputValue('llm-api-key', llm.api_key);

        exampleApiKey = llm.api_key || '';

        setInputValue('llm-max-tokens', llm.max_tokens);
        setInputValue('llm-temperature', llm.temperature);
    }

    if (exampleConfig.server) {
        setInputValue('server-host', exampleConfig.server.host);
        setInputValue('server-port', exampleConfig.server.port);
    }
}

function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input && value !== undefined) {
        input.value = value;
    }
}

function saveConfig() {
    const configData = collectFormData();

    const requiredFields = [
        { id: 'llm-model', name: 'Model Name' },
        { id: 'llm-base-url', name: 'API Base URL' },
        { id: 'llm-api-key', name: 'API Key' },
        { id: 'server-host', name: 'Server Host' },
        { id: 'server-port', name: 'Server Port' }
    ];

    let missingFields = [];
    requiredFields.forEach(field => {
        if (!document.getElementById(field.id).value.trim()) {
            missingFields.push(field.name);
        }
    });

    if (missingFields.length > 0) {
        document.getElementById('config-error').textContent =
            `Please fill in the necessary configuration information: ${missingFields.join(', ')}`;
        return;
    }

    // Check if the API key is the same as the example configuration
    const apiKey = document.getElementById('llm-api-key').value.trim();
    if (apiKey === exampleApiKey && exampleApiKey.includes('sk-')) {
        document.getElementById('config-error').textContent =
            `Please enter your own API key`;
        document.getElementById('llm-api-key').parentElement.classList.add('error');
        return;
    } else {
        document.getElementById('llm-api-key').parentElement.classList.remove('error');
    }

    fetch('/config/save', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(configData)
    })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                document.getElementById('config-modal').classList.remove('active');

                alert('Configuration saved successfully! The application will use the new configuration on next startup.');

                window.location.reload();
            } else {
                document.getElementById('config-error').textContent =
                    `Save failed: ${data.message}`;
            }
        })
        .catch(error => {
            document.getElementById('config-error').textContent =
                `Request error: ${error.message}`;
        });
}

// Collect form data
function collectFormData() {
    const configData = {
        llm: {
            model: document.getElementById('llm-model').value,
            base_url: document.getElementById('llm-base-url').value,
            api_key: document.getElementById('llm-api-key').value
        },
        server: {
            host: document.getElementById('server-host').value,
            port: parseInt(document.getElementById('server-port').value || '5172')
        }
    };

    const maxTokens = document.getElementById('llm-max-tokens').value;
    if (maxTokens) {
        configData.llm.max_tokens = parseInt(maxTokens);
    }

    const temperature = document.getElementById('llm-temperature').value;
    if (temperature) {
        configData.llm.temperature = parseFloat(temperature);
    }

    return configData;
}





