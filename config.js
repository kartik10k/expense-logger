// Configuration for the Expense Logger app
const config = {
    HUGGINGFACE: {
        API_KEY: '', // Will be populated by GitHub Actions or local server
        MODEL: 'mistralai/Mistral-7B-Instruct-v0.2',
        MAX_RETRIES: 3,
        RATE_LIMIT_COOLDOWN: 60000,
    },
    APP: {
        VERSION: '1.0.0',
        CACHE_KEY: 'classificationCache',
    }
};
window.appConfig = config;