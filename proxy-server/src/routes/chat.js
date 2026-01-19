import axios from 'axios';
import { selectProvider } from '../providers/selector.js';
import { getProviderConfig, getAllProviders } from '../providers/config.js';
import { recordRequest } from '../providers/telemetry.js';

const RETRY_MAX = parseInt(process.env.PROXY_RETRY_MAX || '2', 10);
const RETRY_BASE_MS = parseInt(process.env.PROXY_RETRY_BASE_MS || '500', 10);
const RETRY_MAX_MS = parseInt(process.env.PROXY_MAX_MS || process.env.PROXY_RETRY_MAX_MS || '4000', 10);
const FAILOVER_ON_429 = process.env.PROXY_FAILOVER_ON_429 !== 'false';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryable(error) {
    const status = error?.response?.status;
    const code = error?.code;
    return (
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNABORTED'
    );
}

function getRetryDelayMs(error, attempt) {
    const retryAfter = error?.response?.headers?.['retry-after'];
    if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!Number.isNaN(seconds) && seconds > 0) {
            return Math.min(seconds * 1000, RETRY_MAX_MS);
        }
    }

    const base = RETRY_BASE_MS * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 100);
    return Math.min(base + jitter, RETRY_MAX_MS);
}

/**
 * Proxy chat completions requests to AI providers
 */
export async function chatCompletions(req, res) {
    let providerName = 'unknown';
    try {
        const userIP = req.ip || req.connection.remoteAddress;
        const userId = req.user?.id || req.user?.name || 'anonymous';
        console.log(`[${new Date().toISOString()}] Request from ${userIP} user=${userId}`);

        const incomingModel = req.body.model;
        // Select provider based on strategy and model/user
        const provider = selectProvider({ model: incomingModel, user: req.user });
        providerName = provider?.name || 'unknown';
        const providers = getAllProviders(req.user?.allowedProviders);
        if (!provider || providers.length === 0) {
            return res.status(503).json({
                error: {
                    message: 'No AI providers available',
                    type: 'service_unavailable'
                }
            });
        }

        const startIndex = providers.findIndex(p => p.name === provider.name);
        const orderedProviders = startIndex >= 0
            ? [...providers.slice(startIndex), ...providers.slice(0, startIndex)]
            : [provider, ...providers.filter(p => p.name !== provider.name)];

        let lastError = null;

        for (const candidate of orderedProviders) {
            // Get provider configuration
            const config = getProviderConfig(candidate.name, req.user?.allowedProviders);
            if (!config || !config.apiKey) {
                console.error(`Provider ${candidate.name} not configured`);
                recordRequest(candidate.name, false, userId);
                lastError = new Error(`Provider ${candidate.name} not configured`);
                continue;
            }

            // Prepare request
            // Normalize "auto" selectors to the provider's default model
            const effectiveModel = (!incomingModel || incomingModel === 'tlink-proxy-auto' || incomingModel === 'auto')
                ? (config.defaultModel || 'gpt-3.5-turbo')
                : incomingModel;

            console.log(`Using provider: ${candidate.name} model=${effectiveModel}`);

            const requestBody = {
                ...req.body,
                model: effectiveModel
            };
            const wantsStream = requestBody.stream !== false;

            for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
                try {
                    const response = await axios.post(
                        `${config.baseURL}/chat/completions`,
                        requestBody,
                        {
                            headers: {
                                ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
                                'Content-Type': 'application/json',
                                'User-Agent': 'Tlink-AI-Proxy/1.0'
                            },
                            responseType: wantsStream ? 'stream' : 'json', // Stream for SSE, JSON for non-stream
                            timeout: config.timeout || 60000
                        }
                    );

                    recordRequest(candidate.name, true, userId);

                    // Forward status and headers from upstream
                    res.status(response.status);
                    Object.entries(response.headers || {}).forEach(([key, value]) => {
                        if (value) res.setHeader(key, value);
                    });

                    if (!wantsStream) {
                        // Return JSON directly for non-streaming requests
                        res.json(response.data);
                        return;
                    }

                    // Stream response back to client
                    response.data.pipe(res);

                    response.data.on('error', (error) => {
                        console.error('Stream error:', error);
                        if (!res.headersSent) {
                            res.status(500).json({
                                error: {
                                    message: 'Stream error',
                                    type: 'stream_error'
                                }
                            });
                        } else {
                            res.end();
                        }
                    });
                    return;
                } catch (error) {
                    lastError = error;
                    recordRequest(candidate.name, false, userId);
                    const status = error?.response?.status;
                    const shouldRetry = isRetryable(error) && attempt < RETRY_MAX;
                    const shouldFailover = status === 429 && FAILOVER_ON_429 && attempt >= RETRY_MAX;

                    console.error(`Proxy error from ${candidate.name} (attempt ${attempt + 1}/${RETRY_MAX + 1})`, error?.response?.status || error?.code || error?.message);

                    if (shouldRetry) {
                        const delay = getRetryDelayMs(error, attempt);
                        console.log(`Retrying ${candidate.name} after ${delay}ms`);
                        await sleep(delay);
                        continue;
                    }

                    if (shouldFailover) {
                        console.warn(`Failing over from ${candidate.name} after 429`);
                        break;
                    }

                    if (!isRetryable(error)) {
                        // Non-retryable error - return immediately
                        if (error.response) {
                            return res.status(error.response.status).json({
                                error: {
                                    message: error.response.data?.error?.message || 'Provider error',
                                    type: error.response.data?.error?.type || 'provider_error',
                                    code: error.response.data?.error?.code
                                }
                            });
                        } else if (error.request) {
                            return res.status(503).json({
                                error: {
                                    message: 'Provider unavailable',
                                    type: 'provider_unavailable'
                                }
                            });
                        } else {
                            return res.status(500).json({
                                error: {
                                    message: error.message || 'Internal proxy error',
                                    type: 'internal_error'
                                }
                            });
                        }
                    }
                }
            }
        }

        // If all providers failed
        if (lastError?.response) {
            return res.status(lastError.response.status).json({
                error: {
                    message: lastError.response.data?.error?.message || 'Provider error',
                    type: lastError.response.data?.error?.type || 'provider_error',
                    code: lastError.response.data?.error?.code
                }
            });
        }
        if (lastError?.request) {
            return res.status(503).json({
                error: {
                    message: 'Provider unavailable',
                    type: 'provider_unavailable'
                }
            });
        }
        return res.status(500).json({
            error: {
                message: lastError?.message || 'Internal proxy error',
                type: 'internal_error'
            }
        });

    } catch (error) {
        console.error('Proxy error:', error);
        // Record telemetry
        const userId = req.user?.id || req.user?.name || 'anonymous';
        recordRequest(providerName, false, userId);

        // Handle axios errors
        if (error.response) {
            // Provider returned an error
            return res.status(error.response.status).json({
                error: {
                    message: error.response.data?.error?.message || 'Provider error',
                    type: error.response.data?.error?.type || 'provider_error',
                    code: error.response.data?.error?.code
                }
            });
        } else if (error.request) {
            // Request made but no response
            return res.status(503).json({
                error: {
                    message: 'Provider unavailable',
                    type: 'provider_unavailable'
                }
            });
        } else {
            // Error setting up request
            return res.status(500).json({
                error: {
                    message: error.message || 'Internal proxy error',
                    type: 'internal_error'
                }
            });
        }
    }
}
