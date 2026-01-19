/**
 * Provider configurations
 * Load API keys from environment variables
 */

function isValidKey(key, placeholder) {
    if (!key) return false;
    const normalized = key.trim().toLowerCase();
    return normalized !== placeholder.toLowerCase();
}

function parseKeyList(singleKey, multiKey, placeholder = '') {
    const keys = [];
    if (multiKey) {
        const split = multiKey.split(',').map(k => k.trim()).filter(Boolean);
        for (const key of split) {
            if (isValidKey(key, placeholder)) {
                keys.push(key);
            }
        }
    }
    if (singleKey && isValidKey(singleKey, placeholder)) {
        keys.push(singleKey.trim());
    }
    return keys;
}

function buildProviderConfigs() {
    const openaiKeys = parseKeyList(process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEYS, 'your_openai_api_key_here');
    const anthropicKeys = parseKeyList(process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_API_KEYS, 'your_anthropic_api_key_here');
    const groqKeys = parseKeyList(process.env.GROQ_API_KEY, process.env.GROQ_API_KEYS, '');
    const groqDefaultModel = process.env.GROQ_DEFAULT_MODEL || 'llama-3.1-8b-instant';
    const openaiDefaultModel = process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o-mini';
    const anthropicDefaultModel = process.env.ANTHROPIC_DEFAULT_MODEL || 'claude-3-sonnet-20240229';
    const allowList = process.env.ALLOWED_PROVIDERS ? process.env.ALLOWED_PROVIDERS.split(',').map(s => s.trim()).filter(Boolean) : null;

    const configs = {};

    groqKeys.forEach((key, index) => {
        const name = groqKeys.length > 1 ? `groq-${index + 1}` : 'groq';
        configs[name] = {
            name,
            baseURL: 'https://api.groq.com/openai/v1',
            apiKey: key,
            defaultModel: groqDefaultModel,
            timeout: 30000,
            enabled: true
        };
    });

    openaiKeys.forEach((key, index) => {
        const name = openaiKeys.length > 1 ? `openai-${index + 1}` : 'openai';
        configs[name] = {
            name,
            baseURL: 'https://api.openai.com/v1',
            apiKey: key,
            defaultModel: openaiDefaultModel,
            timeout: 60000,
            enabled: true
        };
    });

    anthropicKeys.forEach((key, index) => {
        const name = anthropicKeys.length > 1 ? `anthropic-${index + 1}` : 'anthropic';
        configs[name] = {
            name,
            baseURL: 'https://api.anthropic.com/v1',
            apiKey: key,
            defaultModel: anthropicDefaultModel,
            timeout: 60000,
            enabled: true
        };
    });

    const all = Object.values(configs);

    if (allowList && allowList.length > 0) {
        return Object.fromEntries(
            all
                .filter(cfg => allowList.includes(cfg.name) || allowList.includes(cfg.name.split('-')[0]))
                .map(cfg => [cfg.name, cfg])
        );
    }

    return configs;
}

export function getProviderConfig(providerName, allowedProviders) {
    const configs = buildProviderConfigs();
    if (allowedProviders && allowedProviders.length > 0 && !allowedProviders.includes(providerName) && !allowedProviders.includes(providerName.split('-')[0])) {
        return null;
    }
    return configs[providerName] || null;
}

export function getAllProviders(allowedProviders) {
    const configs = buildProviderConfigs();
    return Object.values(configs).filter(p => p && p.enabled).filter(p => {
        if (!allowedProviders || allowedProviders.length === 0) return true;
        return allowedProviders.includes(p.name) || allowedProviders.includes(p.name.split('-')[0]);
    });
}
