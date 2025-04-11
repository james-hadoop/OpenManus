/**
 * i18n-bridge.js - Multi-language support module
 * Provides interface language switching functionality
 */

// Export to window object for non-module scripts
window.i18n = (() => {
    // Default language
    let currentLanguage = 'en';

    // Supported languages
    const supportedLanguages = ['en', 'zh', 'ja', 'ko'];

    // Language text data
    const translations = {
        en: {
            // Common
            app_name: 'OpenManus',
            app_subtitle: 'Your Intelligent AI Assistant',
            app_description: 'Powered by LLMs and diverse tools. OpenManus completes tasks through AI reasoning.',
            start_button: 'START',
            switch_language: 'Language',
            powered_by: 'Powered by',
            diverse_tools: 'diverse tools',
            ai_reasoning: 'AI reasoning',
            and: 'and',
            openmanus_completes: 'OpenManus completes tasks through',

            // Navigation
            nav_introduction: 'Introduction',
            nav_examples: 'Examples',
            nav_history: 'History',
            nav_github: 'GitHub',
            nav_config: 'Configuration',
            toggle_theme: 'Toggle theme',
            config_button: 'Configuration',

            // Chat interface
            chat_title: 'AI Intelligent Assistant',
            chat_input_placeholder: 'Enter your instruction here...',
            chat_send: 'Send',
            chat_new_session: 'New Session',
            chat_terminate: 'Terminate',
            session_id_label: 'Session ID',
            status_not_connected: 'Not connected',
            status_processing: 'Processing',
            status_connected: 'Connected',
            current_task_label: 'Current Task:',
            agent_column_title: 'Manus Agent',
            agent_name: 'Manus',
            processing_step: 'Manus is processing... (Step ${agentStatus.currentStep}/${agentStatus.maxSteps})',
            thinking: 'Manus is thinking...',
            tool_column_title: 'OpenManus',
            manus_completed: 'Manus is completed',
            manus_in_use: 'Manus in use: ${currentToolInUse}',
            tool_output: 'Tool Output',
            screenshot_note: 'Current visible area screenshot',
            select_upload_method: 'Select upload method',
            upload_to_workspace: 'Upload to workspace',
            upload_workspace_desc: 'Files will be saved to the server and can be used in multiple sessions',
            load_to_input: 'Load to input',
            load_input_desc: 'File content will be loaded directly to the input box, making it easier for direct analysis',
            system_name: 'OpenManus',
            system_description_1: 'is an intelligent agent platform based on large language models',
            system_description_2: 'integrating diverse tool capabilities',
            system_description_3: 'supporting complex task execution',
            system_description_4: 'and automation processes',

            // Configuration panel
            config_title: 'System Configuration',
            config_save: 'Save Changes',
            config_cancel: 'Cancel',
            config_llm: 'LLM Configuration',
            config_browser: 'Browser Configuration',
            config_search: 'Search Configuration',
            config_sandbox: 'Sandbox Configuration',
            config_server: 'Server Configuration',

            // Tools bar
            tools_title: 'Tool List',
            files_title: 'File Browser',
            session_control: 'Session Control',
            system_info: 'System Information',

            // Notification text
            downloading_file: 'Downloading: ${filename}',
            file_list_updated: 'File list has been updated',
            file_delete_confirm: 'Are you sure you want to delete file "${filename}"? This action cannot be undone.',
            file_deleted: 'File deleted: ${filename}',
            file_delete_failed: 'Failed to delete file: ${filename}',
            failed_fetch_files: 'Failed to fetch file list, please check network connection or server status',
            config_saved: 'Configuration saved successfully',
            config_save_failed: 'Failed to save configuration',
            server_restart: 'Server is restarting...',
            text_file_only: 'Only text files can be loaded to input',
            file_too_large: 'File ${filename} is too large, only part of the content is loaded',
            file_loaded: 'File ${filename} has been loaded to input',
            file_read_failed: 'Failed to read file ${filename}',
            uploading_file: 'Uploading file: ${filename}...',
            file_uploaded: 'File ${filename} has been uploaded successfully',
            upload_failed: 'Failed to upload file, please try again later',
            gradient_enabled: 'Blue-red gradient effect has been enabled',
            gradient_disabled: 'Blue-red gradient effect has been disabled',
        },
        zh: {
            // Common
            app_name: 'OpenManus',
            app_subtitle: '智能AI助手',
            app_description: '由大型语言模型和多种工具驱动。OpenManus通过AI推理完成任务。',
            start_button: '开始使用',
            switch_language: '语言',
            powered_by: '由',
            diverse_tools: '多种工具',
            ai_reasoning: 'AI推理',
            and: '和',
            openmanus_completes: 'OpenManus通过',

            // Navigation
            nav_introduction: '介绍',
            nav_examples: '示例',
            nav_history: '历史记录',
            nav_github: 'GitHub',
            nav_config: '系统配置',
            toggle_theme: '切换主题',
            config_button: '配置',

            // Chat interface
            chat_title: '智能AI助手',
            chat_input_placeholder: '在此输入您的指令...',
            chat_send: '发送',
            chat_new_session: '新会话',
            chat_terminate: '终止',
            session_id_label: '会话ID',
            status_not_connected: '未连接',
            status_processing: '处理中',
            status_connected: '已连接',
            current_task_label: '当前任务：',
            agent_column_title: 'Manus助手',
            agent_name: 'Manus',
            processing_step: 'Manus正在处理中... (步骤 ${agentStatus.currentStep}/${agentStatus.maxSteps})',
            thinking: 'Manus正在思考...',
            tool_column_title: 'OpenManus',
            manus_completed: 'Manus已完成',
            manus_in_use: 'Manus正在使用: ${currentToolInUse}',
            tool_output: '工具输出',
            screenshot_note: '当前可见区域截图',
            select_upload_method: '选择上传方式',
            upload_to_workspace: '上传到工作区',
            upload_workspace_desc: '文件将保存到服务器，可在多个会话中使用',
            load_to_input: '加载到输入框',
            load_input_desc: '文件内容将直接加载到输入框，便于直接分析',
            system_name: 'OpenManus',
            system_description_1: '是一个基于大型语言模型的智能代理平台',
            system_description_2: '整合多种工具能力',
            system_description_3: '支持复杂任务执行',
            system_description_4: '和自动化流程',

            // Configuration panel
            config_title: '系统配置',
            config_save: '保存更改',
            config_cancel: '取消',
            config_llm: '大语言模型配置',
            config_browser: '浏览器配置',
            config_search: '搜索引擎配置',
            config_sandbox: '沙箱配置',
            config_server: '服务器配置',

            // Tools bar
            tools_title: '工具列表',
            files_title: '文件浏览器',
            session_control: '会话控制',
            system_info: '系统信息',

            // Notification text
            downloading_file: '正在下载：${filename}',
            file_list_updated: '文件列表已更新',
            file_delete_confirm: '您确定要删除文件"${filename}"吗？此操作无法撤消。',
            file_deleted: '文件已删除：${filename}',
            file_delete_failed: '删除文件失败：${filename}',
            failed_fetch_files: '获取文件列表失败，请检查网络连接或服务器状态',
            config_saved: '配置已成功保存',
            config_save_failed: '保存配置失败',
            server_restart: '服务器正在重启...',
            text_file_only: '只有文本文件可以加载到输入',
            file_too_large: '文件${filename}太大，只能加载内容的一部分',
            file_loaded: '文件${filename}已加载到输入',
            file_read_failed: '读取文件${filename}失败',
            uploading_file: '正在上传文件：${filename}...',
            file_uploaded: '文件${filename}上传成功',
            upload_failed: '上传文件失败，请稍后再试',
            gradient_enabled: '已启用蓝红渐变效果',
            gradient_disabled: '已禁用蓝红渐变效果',
        },
        ja: {
            // Common
            app_name: 'OpenManus',
            app_subtitle: 'インテリジェントAIアシスタント',
            app_description: '大規模言語モデルと多様なツールを搭載。OpenManusはAI推論によりタスクを完了します。',
            start_button: '始める',
            switch_language: '言語',
            powered_by: '搭載：',
            diverse_tools: '多様なツール',
            ai_reasoning: 'AI推論',
            and: 'と',
            openmanus_completes: 'OpenManusは以下により、タスクを完了します',

            // Navigation
            nav_introduction: '紹介',
            nav_examples: '例',
            nav_history: '履歴',
            nav_github: 'GitHub',
            nav_config: 'システム設定',
            toggle_theme: 'テーマ切替',
            config_button: '設定',

            // Chat interface
            chat_title: 'インテリジェントAIアシスタント',
            chat_input_placeholder: 'ここに指示を入力してください...',
            chat_send: '送信',
            chat_new_session: '新しいセッション',
            chat_terminate: '終了',
            session_id_label: 'セッションID',
            status_not_connected: '接続されていません',
            status_processing: '処理中',
            status_connected: '接続済み',
            current_task_label: '現在のタスク：',
            agent_column_title: 'Manusエージェント',
            agent_name: 'Manus',
            processing_step: 'Manusは処理中です... (ステップ ${agentStatus.currentStep}/${agentStatus.maxSteps})',
            thinking: 'Manusは考え中です...',
            tool_column_title: 'OpenManus',
            manus_completed: 'Manusは完了しました',
            manus_in_use: 'Manus使用中: ${currentToolInUse}',
            tool_output: 'ツール出力',
            screenshot_note: '現在の表示領域のスクリーンショット',
            select_upload_method: 'アップロード方法を選択',
            upload_to_workspace: 'ワークスペースにアップロード',
            upload_workspace_desc: 'ファイルはサーバーに保存され、複数のセッションで使用できます',
            load_to_input: '入力欄に読み込む',
            load_input_desc: 'ファイル内容が入力欄に直接読み込まれ、分析が容易になります',
            system_name: 'OpenManus',
            system_description_1: 'は大規模言語モデルをベースにした知的エージェントプラットフォームで',
            system_description_2: '多様なツール機能を統合し',
            system_description_3: '複雑なタスク実行',
            system_description_4: 'と自動化プロセスをサポートします',

            // Configuration panel
            config_title: 'システム設定',
            config_save: '変更を保存',
            config_cancel: 'キャンセル',
            config_llm: '大規模言語モデル設定',
            config_browser: 'ブラウザ設定',
            config_search: '検索エンジン設定',
            config_sandbox: 'サンドボックス設定',
            config_server: 'サーバー設定',

            // Tools bar
            tools_title: 'ツールリスト',
            files_title: 'ファイルブラウザ',
            session_control: 'セッション制御',
            system_info: 'システム情報',

            // Notification text
            downloading_file: 'ダウンロード中: ${filename}',
            file_list_updated: 'ファイルリストが更新されました',
            file_delete_confirm: 'ファイル"${filename}"を削除してもよろしいですか？この操作は元に戻せません。',
            file_deleted: 'ファイルが削除されました: ${filename}',
            file_delete_failed: 'ファイルの削除に失敗しました: ${filename}',
            failed_fetch_files: 'ファイルリストの取得に失敗しました。ネットワーク接続またはサーバーの状態を確認してください',
            config_saved: '設定が正常に保存されました',
            config_save_failed: '設定の保存に失敗しました',
            server_restart: 'サーバーが再起動しています...',
            text_file_only: 'テキストファイルのみ入力に読み込めます',
            file_too_large: 'ファイル${filename}が大きすぎるため、一部のみが読み込まれました',
            file_loaded: 'ファイル${filename}が入力に読み込まれました',
            file_read_failed: 'ファイル${filename}の読み取りに失敗しました',
            uploading_file: 'ファイルをアップロード中: ${filename}...',
            file_uploaded: 'ファイル${filename}が正常にアップロードされました',
            upload_failed: 'ファイルのアップロードに失敗しました。後でもう一度お試しください',
            gradient_enabled: '青赤グラデーション効果が有効になりました',
            gradient_disabled: '青赤グラデーション効果が無効になりました',
        },
        ko: {
            // Common
            app_name: 'OpenManus',
            app_subtitle: '지능형 AI 어시스턴트',
            app_description: '대규모 언어 모델과 다양한 도구를 활용합니다. OpenManus는 AI 추론을 통해 작업을 완료합니다.',
            start_button: '시작하기',
            switch_language: '언어',
            powered_by: '활용:',
            diverse_tools: '다양한 도구',
            ai_reasoning: 'AI 추론',
            and: '과',
            openmanus_completes: 'OpenManus는 다음을 통해 작업을 완료합니다',

            // Navigation
            nav_introduction: '소개',
            nav_examples: '예제',
            nav_history: '기록',
            nav_github: 'GitHub',
            nav_config: '시스템 구성',
            toggle_theme: '테마 전환',
            config_button: '설정',

            // Chat interface
            chat_title: '지능형 AI 어시스턴트',
            chat_input_placeholder: '여기에 지시 사항을 입력하세요...',
            chat_send: '보내기',
            chat_new_session: '새 세션',
            chat_terminate: '종료',
            session_id_label: '세션 ID',
            status_not_connected: '연결되지 않음',
            status_processing: '처리 중',
            status_connected: '연결됨',
            current_task_label: '현재 작업:',
            agent_column_title: 'Manus 에이전트',
            agent_name: 'Manus',
            processing_step: 'Manus가 처리 중입니다... (단계 ${agentStatus.currentStep}/${agentStatus.maxSteps})',
            thinking: 'Manus가 생각 중입니다...',
            tool_column_title: 'OpenManus',
            manus_completed: 'Manus가 완료되었습니다',
            manus_in_use: 'Manus 사용 중: ${currentToolInUse}',
            tool_output: '도구 출력',
            screenshot_note: '현재 보이는 영역 스크린샷',
            select_upload_method: '업로드 방법 선택',
            upload_to_workspace: '작업 공간에 업로드',
            upload_workspace_desc: '파일이 서버에 저장되어 여러 세션에서 사용할 수 있습니다',
            load_to_input: '입력란에 로드',
            load_input_desc: '파일 내용이 입력 상자에 직접 로드되어 직접 분석이 더 쉬워집니다',
            system_name: 'OpenManus',
            system_description_1: '는 대규모 언어 모델 기반의 지능형 에이전트 플랫폼입니다',
            system_description_2: '다양한 도구 기능을 통합하고',
            system_description_3: '복잡한 작업 실행',
            system_description_4: '및 자동화 프로세스를 지원합니다',

            // Configuration panel
            config_title: '시스템 구성',
            config_save: '변경 사항 저장',
            config_cancel: '취소',
            config_llm: '대규모 언어 모델 설정',
            config_browser: '브라우저 설정',
            config_search: '검색 엔진 설정',
            config_sandbox: '샌드박스 설정',
            config_server: '서버 설정',

            // Tools bar
            tools_title: '도구 목록',
            files_title: '파일 브라우저',
            session_control: '세션 제어',
            system_info: '시스템 정보',

            // Notification text
            downloading_file: '다운로드 중: ${filename}',
            file_list_updated: '파일 목록이 업데이트되었습니다',
            file_delete_confirm: '파일 "${filename}"을(를) 삭제하시겠습니까? 이 작업은 취소할 수 없습니다.',
            file_deleted: '파일이 삭제되었습니다: ${filename}',
            file_delete_failed: '파일 삭제 실패: ${filename}',
            failed_fetch_files: '파일 목록을 가져오지 못했습니다. 네트워크 연결 또는 서버 상태를 확인하세요',
            config_saved: '구성이 성공적으로 저장되었습니다',
            config_save_failed: '구성 저장 실패',
            server_restart: '서버가 다시 시작 중입니다...',
            text_file_only: '텍스트 파일만 입력에 로드할 수 있습니다',
            file_too_large: '파일 ${filename}이(가) 너무 큽니다. 내용의 일부만 로드되었습니다',
            file_loaded: '파일 ${filename}이(가) 입력에 로드되었습니다',
            file_read_failed: '파일 ${filename} 읽기 실패',
            uploading_file: '파일 업로드 중: ${filename}...',
            file_uploaded: '파일 ${filename}이(가) 성공적으로 업로드되었습니다',
            upload_failed: '파일 업로드 실패, 나중에 다시 시도하세요',
            gradient_enabled: '청색-적색 그라데이션 효과가 활성화되었습니다',
            gradient_disabled: '청색-적색 그라데이션 효과가 비활성화되었습니다',
        }
    };

    // Initialize function
    const init = () => {
        // Get saved language setting from localStorage
        const savedLang = localStorage.getItem('openmanus_language');
        if (savedLang && supportedLanguages.includes(savedLang)) {
            currentLanguage = savedLang;
        } else {
            // If no saved language setting, try using browser language
            const browserLang = navigator.language.split('-')[0];
            if (supportedLanguages.includes(browserLang)) {
                currentLanguage = browserLang;
            }
        }

        // Update HTML lang attribute
        document.documentElement.lang = currentLanguage;

        // Apply initial translations
        applyTranslations();
    };

    // Switch language
    const setLanguage = (lang) => {
        if (supportedLanguages.includes(lang) && lang !== currentLanguage) {
            currentLanguage = lang;
            localStorage.setItem('openmanus_language', lang);
            document.documentElement.lang = lang;
            applyTranslations();

            // Trigger custom event to notify language change
            const event = new CustomEvent('languageChanged', { detail: { language: lang } });
            document.dispatchEvent(event);

            return true;
        }
        return false;
    };

    // Get current language
    const getLanguage = () => currentLanguage;

    // Get supported languages list
    const getSupportedLanguages = () => supportedLanguages;

    // Get translated text
    const translate = (key) => {
        if (translations[currentLanguage] && translations[currentLanguage][key]) {
            return translations[currentLanguage][key];
        } else if (translations['en'] && translations['en'][key]) {
            // Fallback to English
            return translations['en'][key];
        }
        return key; // If no translation found, return original key
    };

    // Apply page translations
    const applyTranslations = () => {
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    if (el.getAttribute('placeholder')) {
                        el.setAttribute('placeholder', translate(key));
                    } else {
                        el.value = translate(key);
                    }
                } else {
                    el.textContent = translate(key);
                }
            }
        });
    };

    // Public API
    return {
        init,
        setLanguage,
        getLanguage,
        getSupportedLanguages,
        translate,
        applyTranslations
    };
})();

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.i18n.init();
});
