const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const JSZip = require('jszip');
const app = express();
const port = 3000;
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 50);
const maxFacts = Number(process.env.MAX_FACTS || 12);
const maxLlmTextChars = Number(process.env.MAX_LLM_TEXT_CHARS || 18000);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: maxUploadMb * 1024 * 1024
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/cards', (req, res, next) => {
    console.log(`Serving card image: ${req.url}`); // Debugging line
    next();
}, express.static(path.join(__dirname, 'cards')));
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/upload-config', (req, res) => {
    res.json({ maxUploadMb });
});

app.post('/save-card', async (req, res) => {
    const { imageData, blurRegions, frequencyCategory } = req.body;
    console.log('Received request to save card');
    console.log('Image data length:', imageData.length);
    console.log('Blur regions:', blurRegions);
    console.log('Frequency category:', frequencyCategory);

    try {
        const imageBuffer = Buffer.from(imageData.split(',')[1], 'base64');
        const imageName = `card_${Date.now()}.png`;
        const imagePath = path.join(__dirname, 'cards', imageName);
        const metadata = {
            blurRegions,
            frequencyCategory,
            imagePath: `/cards/${imageName}`
        };
        const metadataPath = path.join(__dirname, 'cards', `${imageName}.json`);

        // Ensure the cards directory exists
        await fs.mkdir(path.join(__dirname, 'cards'), { recursive: true });

        await fs.writeFile(imagePath, imageBuffer);
        await fs.writeFile(metadataPath, JSON.stringify(metadata));
        console.log('Card saved successfully:', imageName);
        res.json({ message: 'Card saved successfully' });
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ error: 'Unexpected error', details: error.message });
    }
});

app.get('/get-cards', (req, res) => {
    const cardsDir = path.join(__dirname, 'cards');
    console.log('Reading cards from directory:', cardsDir);
    fs.readdir(cardsDir, (err, files) => {
        if (err) {
            console.error('Error reading cards directory:', err);
            return res.status(500).json({ error: 'Error reading cards directory', details: err.message });
        }

        const cards = files
            .filter(file => file.endsWith('.png'))
            .map(file => {
                const imagePath = path.join(cardsDir, file);
                const metadataPath = path.join(cardsDir, `${file}.json`);
                console.log('Reading card file:', imagePath);
                try {
                    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                    metadata.imagePath = `/cards/${file}`;
                    return metadata;
                } catch (readErr) {
                    console.error('Error reading card metadata file:', readErr);
                    return null;
                }
            })
            .filter(card => card !== null);

        console.log('Cards fetched:', cards);
        res.json(cards);
    });
});

app.get('/get-card/:index', async (req, res) => {
    const cardsDir = path.join(__dirname, 'cards');
    try {
        const files = await fs.readdir(cardsDir);
        const cardFiles = files.filter(file => file.endsWith('.png'));
        const index = parseInt(req.params.index, 10);

        if (index < 0 || index >= cardFiles.length) {
            return res.status(404).json({ error: 'Card not found' });
        }

        const file = cardFiles[index];
        const metadataPath = path.join(cardsDir, `${file}.json`);
        console.log('Fetching card file:', file); // Debugging line
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        metadata.imagePath = `/cards/${file}`;
        res.json(metadata);
    } catch (err) {
        console.error('Error reading cards directory:', err);
        res.status(500).json({ error: 'Error reading cards directory', details: err.message });
    }
});

app.post('/update-card', (req, res) => {
    const card = req.body;
    const metadataPath = path.join(__dirname, 'cards', `${path.basename(card.imagePath)}.json`);

    fs.writeFile(metadataPath, JSON.stringify(card))
        .then(() => {
            res.json({ message: 'Card updated successfully' });
        })
        .catch((err) => {
            console.error('Error updating card metadata:', err);
            res.status(500).json({ error: 'Error updating card metadata', details: err.message });
        });
});

app.post('/update-frequency', async (req, res) => {
    const { imagePath, knew } = req.body;

    if (!imagePath || typeof knew !== 'boolean') {
        return res.status(400).json({ error: 'imagePath and knew(boolean) are required' });
    }

    try {
        const fileName = path.basename(imagePath);
        const metadataPath = path.join(__dirname, 'cards', `${fileName}.json`);
        const raw = await fs.readFile(metadataPath, 'utf8');
        const metadata = JSON.parse(raw);

        let freq = Number(metadata.frequencyCategory);
        if (!Number.isFinite(freq)) {
            freq = 3;
        }

        if (knew) {
            freq = Math.max(1, freq - 1);
        } else {
            freq = freq + 1;
        }

        metadata.frequencyCategory = freq;
        await fs.writeFile(metadataPath, JSON.stringify(metadata));

        res.json({ message: 'Frequency updated successfully', frequencyCategory: freq });
    } catch (err) {
        console.error('Error updating frequency:', err);
        res.status(500).json({ error: 'Error updating frequency', details: err.message });
    }
});

// Simple fact-checking stub endpoint.
// This does NOT call an LLM yet; it just does a few
// lightweight checks and returns structured feedback.
// You can plug in a small LLM here later (e.g. via an API call).
app.post('/fact-check', async (req, res) => {
    const { text } = req.body || {};

    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required' });
    }

    const trimmed = text.trim();
    const length = trimmed.length;

    const warnings = [];
    if (length > 500) {
        warnings.push('Text is quite long; consider splitting into multiple cards.');
    }
    if (!/[.?!]/.test(trimmed)) {
        warnings.push('Text has no clear sentence ending punctuation; make sure it reads like a complete fact.');
    }
    if (/(always|never|everyone|nobody)/i.test(trimmed)) {
        warnings.push('Contains strong absolute terms (always/never/everyone/nobody); double-check that this is really always true.');
    }

    const verdict = warnings.length === 0 ? 'looks-ok' : 'needs-review';

    // Placeholder summary. Replace this with a real LLM call if desired.
    const summary = 'Automatic checks finished. This is not a real fact-check yet; please review the content yourself.';

    res.json({
        verdict,
        summary,
        warnings
    });
});

function fallbackExtractFacts(text) {
    const rawSentences = text
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(Boolean);

    const facts = [];
    for (const sentence of rawSentences) {
        if (sentence.length < 20) {
            continue;
        }
        facts.push(sentence);
        if (facts.length >= maxFacts) {
            break;
        }
    }

    if (facts.length === 0) {
        const compact = text.replace(/\s+/g, ' ').trim();
        if (compact) {
            facts.push(compact.length > 180 ? `${compact.slice(0, 177)}...` : compact);
        }
    }

    return facts;
}

function cleanFactCandidates(candidates, sourceText, limit = maxFacts) {
    if (!Array.isArray(candidates)) {
        return [];
    }

    const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'from', 'as', 'is', 'are', 'was', 'were'
    ]);

    const sourceTokens = new Set(
        String(sourceText || '')
            .toLowerCase()
            .match(/[a-z0-9]+/g) || []
    );

    const hasVerb = (line) => /\b(is|are|was|were|be|being|been|has|have|had|does|do|did|can|could|may|might|must|should|produces|contains|includes|uses|occurs|means|refers|causes|enables|supports|requires|involves|forms|becomes)\b/i.test(line)
        || /\b\w+(ed|ing)\b/i.test(line);

    const normalize = (line) => String(line || '')
        .replace(/^\s*[-*\d.)]+\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();

    const unwrapJsonLikeLine = (line) => {
        let current = line
            .replace(/\\"/g, '"')
            .replace(/\s*,\s*$/, '')
            .trim();

        if (/^["']?[^"']+["']?\s*:\s*\{\s*$/.test(current)) {
            return '';
        }

        const doubleQuotedValueMatch = current.match(/^"[^"]+"\s*:\s*"([\s\S]+)"\s*$/);
        if (doubleQuotedValueMatch) {
            current = doubleQuotedValueMatch[1].trim();
        }

            const singleQuotedValueMatch = current.match(/^'[^']+'\s*:\s*'([\s\S]+)'\s*$/);
        if (singleQuotedValueMatch) {
            current = singleQuotedValueMatch[1].trim();
        }

        current = current
            .replace(/^["']+|["']+$/g, '')
            .replace(/[{}\[\]]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return current;
    };

    const splitStructuredFactLine = (line) => {
        if (!line) {
            return [];
        }

        const parts = [];
        const quotedPairs = [...line.matchAll(/"([^"\\]+)"\s*:\s*"([^"\\][\s\S]*?)"(?=\s*,\s*"|\s*$)/g)];
        if (quotedPairs.length > 0) {
            for (const pair of quotedPairs) {
                const key = String(pair[1] || '').trim();
                const value = String(pair[2] || '').trim();
                if (key && value) {
                    parts.push(`${key} is ${value}`);
                }
            }
            return parts;
        }

        const unquotedPairs = [...line.matchAll(/(^|,\s*)([A-Za-z][A-Za-z0-9\-\s/()]{2,40})\s*:\s*([^,]{4,})/g)];
        if (unquotedPairs.length >= 2) {
            for (const pair of unquotedPairs) {
                const key = String(pair[2] || '').trim();
                const value = String(pair[3] || '').trim();
                if (key && value) {
                    parts.push(`${key} is ${value}`);
                }
            }
            return parts;
        }

        return [line];
    };

    const seen = new Set();
    const cleaned = [];

    for (const raw of candidates) {
        const base = unwrapJsonLikeLine(normalize(raw));
        const expandedLines = splitStructuredFactLine(base);

        for (let line of expandedLines) {
            line = unwrapJsonLikeLine(normalize(line));
            if (!line) {
                continue;
            }

            if (!/[a-zA-Z]/.test(line)) {
                continue;
            }

            if (line.endsWith(':')) {
                continue;
            }

            if (line.length < 18) {
                continue;
            }

            if (!hasVerb(line)) {
                continue;
            }

            const factTokens = (line.toLowerCase().match(/[a-z0-9]+/g) || [])
                .filter(token => token.length >= 3)
                .filter(token => !stopWords.has(token));
            const overlap = factTokens.filter(token => sourceTokens.has(token)).length;
            const requiredOverlap = Math.max(2, Math.min(4, Math.ceil(factTokens.length * 0.35)));

            if (factTokens.length > 0 && overlap < requiredOverlap) {
                continue;
            }

            if (!/[.!?]$/.test(line)) {
                line = `${line}.`;
            }

            const key = line.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);

            cleaned.push(line);
            if (cleaned.length >= limit) {
                return cleaned;
            }
        }
    }

    return cleaned;
}

function buildCondensedSource(text, maxSentences = 40) {
    const sentences = String(text || '')
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(sentence => sentence.length >= 25)
        .slice(0, maxSentences);

    return sentences.join(' ');
}

function buildTextChunks(text, maxChars = 4200) {
    const sentences = String(text || '')
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(Boolean);

    if (sentences.length === 0) {
        return [];
    }

    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
        if (!current) {
            current = sentence;
            continue;
        }

        if ((current.length + 1 + sentence.length) <= maxChars) {
            current += ` ${sentence}`;
        } else {
            chunks.push(current);
            current = sentence;
        }
    }

    if (current) {
        chunks.push(current);
    }

    return chunks;
}

function categorizeFact(fact) {
    const value = String(fact || '').toLowerCase();

    if (/(trade-?off|vs\.?|versus|compared|compare|difference|bias|variance)/i.test(value)) {
        return 'Comparison / Trade-off';
    }

    if (/(causes?|leads? to|results? in|because|therefore|hence|due to)/i.test(value)) {
        return 'Cause and Effect';
    }

    if (/(algorithm|classifier|model|method|approach|technique|procedure)/i.test(value)) {
        return 'Method';
    }

    if (/(process|step|first|second|then|finally|pipeline|workflow|occurs)/i.test(value)) {
        return 'Process';
    }

    if (/(is|are|refers to|defined as|means|consists of)/i.test(value)) {
        return 'Definition';
    }

    return 'Concept';
}

function selectContextForFact(fact, sourceText) {
    const source = String(sourceText || '').replace(/\s+/g, ' ').trim();
    if (!source) {
        return '';
    }

    const sentences = source
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(Boolean);

    if (sentences.length === 0) {
        return source.slice(0, 260);
    }

    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'from', 'as', 'is', 'are', 'was', 'were', 'that', 'this']);
    const factTokens = (String(fact || '').toLowerCase().match(/[a-z0-9]+/g) || [])
        .filter(token => token.length >= 4)
        .filter(token => !stopWords.has(token));

    let bestIndex = 0;
    let bestScore = -1;
    for (let index = 0; index < sentences.length; index++) {
        const sentenceTokens = new Set((sentences[index].toLowerCase().match(/[a-z0-9]+/g) || []));
        const score = factTokens.reduce((count, token) => count + (sentenceTokens.has(token) ? 1 : 0), 0);
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }

    const start = Math.max(0, bestIndex - 1);
    const end = Math.min(sentences.length, bestIndex + 2);
    const snippet = sentences.slice(start, end).join(' ');
    return snippet.length > 320 ? `${snippet.slice(0, 317)}...` : snippet;
}

function selectSourcePreviewForFact(fact, sourceText) {
    const source = String(sourceText || '').replace(/\s+/g, ' ').trim();
    if (!source) {
        return '';
    }

    const sentences = source
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(Boolean);

    if (sentences.length === 0) {
        return source.length > 520 ? `${source.slice(0, 517)}...` : source;
    }

    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'from', 'as', 'is', 'are', 'was', 'were', 'that', 'this']);
    const factTokens = (String(fact || '').toLowerCase().match(/[a-z0-9]+/g) || [])
        .filter(token => token.length >= 4)
        .filter(token => !stopWords.has(token));

    let bestIndex = 0;
    let bestScore = -1;
    for (let index = 0; index < sentences.length; index++) {
        const sentenceTokens = new Set((sentences[index].toLowerCase().match(/[a-z0-9]+/g) || []));
        const score = factTokens.reduce((count, token) => count + (sentenceTokens.has(token) ? 1 : 0), 0);
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }

    const start = Math.max(0, bestIndex - 1);
    const end = Math.min(sentences.length, bestIndex + 2);
    const preview = sentences.slice(start, end).join(' ');
    return preview.length > 520 ? `${preview.slice(0, 517)}...` : preview;
}

function enrichFacts(facts, sourceText) {
    return (Array.isArray(facts) ? facts : []).map(fact => ({
        fact,
        category: categorizeFact(fact),
        context: selectContextForFact(fact, sourceText),
        sourcePreview: selectSourcePreviewForFact(fact, sourceText)
    }));
}

function compactFactStatement(fact, maxWords = 24) {
    let value = String(fact || '')
        .replace(/\s+/g, ' ')
        .replace(/^"|"$/g, '')
        .trim();

    value = value
        .replace(/\b(in this lecture|as discussed|for example|for instance)\b[:,]?/gi, '')
        .replace(/\s+,/g, ',')
        .trim();

    const commaParts = value.split(',').map(part => part.trim()).filter(Boolean);
    if (commaParts.length > 1) {
        // Keep concise core statement and one supporting clause.
        value = `${commaParts[0]}${commaParts[1] ? `, ${commaParts[1]}` : ''}`;
    }

    const words = value.split(/\s+/).filter(Boolean);
    if (words.length > maxWords) {
        value = words.slice(0, maxWords).join(' ');
    }

    value = value
        .replace(/[;:]+$/g, '')
        .trim();

    if (!/[.!?]$/.test(value)) {
        value += '.';
    }

    return value;
}

function refineFactsForCards(facts, sourceText) {
    const compacted = (Array.isArray(facts) ? facts : [])
        .map(fact => compactFactStatement(fact, 22))
        .filter(Boolean);

    return cleanFactCandidates(compacted, sourceText, maxFacts);
}

function normalizeExtractionSettings(input) {
    const value = input && typeof input === 'object' ? input : {};

    let requestedMaxFacts = Number(value.maxFacts);
    if (!Number.isFinite(requestedMaxFacts)) {
        requestedMaxFacts = maxFacts;
    }

    const clampedMaxFacts = Math.max(1, Math.min(30, Math.round(requestedMaxFacts)));

    let requestedMinFactWords = Number(value.minFactWords);
    if (!Number.isFinite(requestedMinFactWords)) {
        requestedMinFactWords = 8;
    }

    let requestedMaxFactWords = Number(value.maxFactWords);
    if (!Number.isFinite(requestedMaxFactWords)) {
        requestedMaxFactWords = 22;
    }

    const clampedMinFactWords = Math.max(3, Math.min(30, Math.round(requestedMinFactWords)));
    const clampedMaxFactWords = Math.max(clampedMinFactWords, Math.min(60, Math.round(requestedMaxFactWords)));

    return {
        maxFacts: clampedMaxFacts,
        fastMode: Boolean(value.fastMode),
        includeSourcePreview: value.includeSourcePreview !== false,
        minFactWords: clampedMinFactWords,
        maxFactWords: clampedMaxFactWords
    };
}

function applyFactWordSettings(facts, settings) {
    const normalizedSettings = normalizeExtractionSettings(settings);
    const minWords = normalizedSettings.minFactWords;
    const maxWords = normalizedSettings.maxFactWords;

    const normalizedFacts = (Array.isArray(facts) ? facts : [])
        .map(fact => compactFactStatement(fact, maxWords))
        .filter(Boolean);

    const inRange = normalizedFacts.filter(fact => {
        const words = String(fact).trim().split(/\s+/).filter(Boolean).length;
        return words >= minWords;
    });

    return inRange.length > 0 ? inRange : normalizedFacts;
}

function finalizeExtractionResult(facts, sourceText, settings) {
    const normalizedSettings = normalizeExtractionSettings(settings);
    const factCandidates = applyFactWordSettings(facts, normalizedSettings);
    const list = factCandidates.slice(0, normalizedSettings.maxFacts);
    const enriched = enrichFacts(list, sourceText).map(item => {
        if (normalizedSettings.includeSourcePreview) {
            return item;
        }

        return {
            ...item,
            sourcePreview: ''
        };
    });

    return {
        facts: list,
        enrichedFacts: enriched,
        settings: normalizedSettings
    };
}

async function extractFactsWithRetries(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return [];
    }

    // For very large inputs, skip LLM entirely and fall back to
    // local extraction to keep response times reasonable.
    if (normalized.length > maxLlmTextChars) {
        console.log(`extractFactsWithRetries: text length ${normalized.length} exceeds maxLlmTextChars=${maxLlmTextChars}, using fallback only`);
        const fallbackFacts = refineFactsForCards(
            cleanFactCandidates(fallbackExtractFacts(normalized), normalized, maxFacts),
            normalized
        );
        return fallbackFacts;
    }

    const mergeFacts = (existing, incoming) => cleanFactCandidates([
        ...(Array.isArray(existing) ? existing : []),
        ...(Array.isArray(incoming) ? incoming : [])
    ], normalized, maxFacts);

    let collected = [];

    // Attempt 1: full text
    collected = mergeFacts(collected, await extractFactsWithLlm(normalized));
    if (collected.length >= maxFacts) {
        return refineFactsForCards(collected, normalized);
    }

    // Attempt 2: chunked extraction for long documents (e.g., PPTX/PDF)
    if (normalized.length > 7000) {
        const chunks = buildTextChunks(normalized, 4200).slice(0, 8);
        for (const chunk of chunks) {
            if (!chunk || chunk.length < 120) {
                continue;
            }
            collected = mergeFacts(collected, await extractFactsWithLlm(chunk));
            if (collected.length >= maxFacts) {
                return refineFactsForCards(collected, normalized);
            }
        }
    }

    // Attempt 3: condensed source retry if still too few
    if (collected.length < Math.min(6, maxFacts)) {
        const condensed = buildCondensedSource(normalized, 55);
        if (condensed && condensed !== normalized) {
            collected = mergeFacts(collected, await extractFactsWithLlm(condensed));
        }
    }

    return refineFactsForCards(collected, normalized);
}

async function extractFactsWithLlm(text) {
    const provider = (process.env.LLM_PROVIDER || 'ollama').toLowerCase();

    if (provider === 'ollama') {
        const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
        const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2:1b';
        const prompt = [
            'You extract flashcard facts from source text.',
            'Return strict JSON only in this shape: {"facts":["..."]}.',
            'Rules:',
            `- Maximum ${maxFacts} facts.`,
            '- Each fact must be a concise standalone study statement (subject + verb).',
            '- Target 10-22 words per fact.',
            '- Do NOT output titles, headers, fragments, or bullet labels.',
            '- Use only information explicitly present in the source text.',
            '- Do NOT add outside knowledge or inferred details.',
            '- Rewrite into clear card-ready wording, not raw copied chunks.',
            '',
            text
        ].join('\n');

        const response = await fetch(ollamaUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: ollamaModel,
                prompt,
                stream: false,
                format: 'json'
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama API error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const content = String(data?.response || '').trim();
        if (!content) {
            throw new Error('Ollama response did not contain content');
        }

        const normalizeFacts = (facts) => Array.isArray(facts)
            ? facts
                .map(fact => String(fact).trim())
                .filter(Boolean)
                .slice(0, maxFacts)
            : [];

        try {
            const parsed = JSON.parse(content);
            const directFacts = cleanFactCandidates(normalizeFacts(parsed.facts), text);
            if (directFacts.length > 0) {
                return directFacts;
            }
        } catch (parseErr) {
            // Continue with tolerant parsing below.
        }

        // Try to recover JSON object from mixed output.
        const firstBrace = content.indexOf('{');
        const lastBrace = content.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            const jsonSlice = content.slice(firstBrace, lastBrace + 1);
            try {
                const parsedSlice = JSON.parse(jsonSlice);
                const slicedFacts = cleanFactCandidates(normalizeFacts(parsedSlice.facts), text);
                if (slicedFacts.length > 0) {
                    return slicedFacts;
                }
            } catch (sliceErr) {
                // Continue with line-based extraction.
            }
        }

        // Final tolerant extraction from lines/bullets.
        const lineFacts = content
            .split(/\r?\n/)
            .map(line => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
            .filter(Boolean)
            .slice(0, maxFacts);

        const cleanedLineFacts = cleanFactCandidates(lineFacts, text);

        if (cleanedLineFacts.length > 0) {
            return cleanedLineFacts;
        }

        return [];
    }

    const apiUrl = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    const model = process.env.LLM_MODEL || 'gpt-4o-mini';

    if (!apiKey) {
        return null;
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: `Extract flashcard facts from source text. Return strict JSON only: {"facts":["..."]}. Each fact must be a complete standalone sentence with a verb; no titles/fragments. Use only information present in source text. Maximum ${maxFacts} facts.`
                },
                {
                    role: 'user',
                    content: text
                }
            ]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('LLM response did not contain content');
    }

    const parsed = JSON.parse(content);
    const facts = Array.isArray(parsed.facts)
        ? parsed.facts
            .map(fact => String(fact).trim())
            .filter(Boolean)
            .slice(0, maxFacts)
        : [];

    const cleaned = cleanFactCandidates(facts, text, maxFacts);
    return refineFactsForCards(cleaned, text);
}

async function extractTextFromUploadedFile(file) {
    if (!file) {
        throw new Error('No file uploaded');
    }

    const extension = path.extname(file.originalname || '').toLowerCase();
    const mimeType = (file.mimetype || '').toLowerCase();

    // Default structure: always return an object with text and images[]
    const result = {
        text: '',
        images: []
    };

    if (extension === '.pdf' || mimeType.includes('pdf')) {
        const parsed = await pdfParse(file.buffer);
        result.text = parsed.text || '';
        // PDF image extraction is not yet implemented; images remain empty for now.
        return result;
    }

    if (extension === '.pptx' || mimeType.includes('presentation')) {
        const zip = await JSZip.loadAsync(file.buffer);
        const allEntries = Object.keys(zip.files);

        const slideFiles = allEntries
            .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
            .sort((a, b) => {
                const aNum = Number((a.match(/slide(\d+)\.xml/i) || [])[1] || 0);
                const bNum = Number((b.match(/slide(\d+)\.xml/i) || [])[1] || 0);
                return aNum - bNum;
            });

        const decodeXmlEntities = (value) => value
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");

        const textParts = [];
        for (const slideName of slideFiles) {
            const xml = await zip.files[slideName].async('string');
            const matches = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(match => decodeXmlEntities(match[1]));
            if (matches.length > 0) {
                textParts.push(matches.join(' '));
            }
        }

        result.text = textParts.join('\n');

        // Additionally, extract embedded slide images into /public/extracted and
        // return their URLs so the frontend can display them.
        const mediaFiles = allEntries
            .filter(name => /^ppt\/media\/.+\.(png|jpe?g|gif|bmp)$/i.test(name));

        console.log(`[pptx] Found ${mediaFiles.length} media image file(s) in ppt/media`);

        if (mediaFiles.length > 0) {
            const outputDir = path.join(__dirname, 'public', 'extracted');
            await fs.mkdir(outputDir, { recursive: true });

            const images = [];
            for (const mediaName of mediaFiles) {
                const baseName = path.basename(mediaName);
                const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${baseName}`;
                const filePath = path.join(outputDir, uniqueName);
                const buffer = await zip.files[mediaName].async('nodebuffer');
                await fs.writeFile(filePath, buffer);

                images.push({
                    url: `/extracted/${uniqueName}`,
                    originalName: baseName
                });
            }

            result.images = images;
        }

        return result;
    }

    const textExtensions = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json']);
    if (textExtensions.has(extension) || mimeType.startsWith('text/')) {
        result.text = file.buffer.toString('utf8');
        return result;
    }

    throw new Error('Unsupported file type. Use PDF or text-based files.');
}

app.post('/extract-facts', async (req, res) => {
    const { text, settings } = req.body || {};
    const normalizedSettings = normalizeExtractionSettings(settings);

    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required' });
    }

    try {
        let llmFacts = [];
        if (normalizedSettings.fastMode) {
            llmFacts = refineFactsForCards(
                cleanFactCandidates(fallbackExtractFacts(text.trim()), text.trim(), normalizedSettings.maxFacts),
                text.trim()
            );
        } else {
            llmFacts = await extractFactsWithRetries(text.trim());
        }

        const finalized = finalizeExtractionResult(llmFacts, text.trim(), normalizedSettings);
        if (llmFacts && llmFacts.length > 0) {
            return res.json({
                source: normalizedSettings.fastMode ? 'fallback-fast' : 'llm',
                facts: finalized.facts,
                enrichedFacts: finalized.enrichedFacts,
                settings: finalized.settings
            });
        }

        const fallbackFacts = refineFactsForCards(cleanFactCandidates(fallbackExtractFacts(text.trim()), text.trim(), maxFacts), text.trim());
        const finalizedFallback = finalizeExtractionResult(fallbackFacts, text.trim(), normalizedSettings);
        return res.json({
            source: 'fallback',
            facts: finalizedFallback.facts,
            enrichedFacts: finalizedFallback.enrichedFacts,
            settings: finalizedFallback.settings,
            note: 'LLM returned no usable facts for this input. Fallback extraction used.'
        });
    } catch (err) {
        console.error('Error extracting facts:', err.message);
        const fallbackFacts = refineFactsForCards(cleanFactCandidates(fallbackExtractFacts(text.trim()), text.trim(), maxFacts), text.trim());
        const finalizedFallback = finalizeExtractionResult(fallbackFacts, text.trim(), normalizedSettings);
        return res.json({
            source: 'fallback',
            facts: finalizedFallback.facts,
            enrichedFacts: finalizedFallback.enrichedFacts,
            settings: finalizedFallback.settings,
            note: 'LLM extraction failed; fallback extraction used.'
        });
    }
});

app.post('/extract-facts-file', (req, res, next) => {
    upload.single('sourceFile')(req, res, (err) => {
        if (!err) {
            return next();
        }

        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: `File too large. Maximum allowed size is ${maxUploadMb}MB.` });
        }

        return next(err);
    });
}, async (req, res) => {
    const startedAt = Date.now();
    let normalizedText = '';
    let imagesFromFile = [];
    let normalizedSettings = normalizeExtractionSettings({});

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded. Use sourceFile form field.' });
        }

        try {
            const rawSettings = req.body?.settings ? JSON.parse(req.body.settings) : {};
            normalizedSettings = normalizeExtractionSettings(rawSettings);
        } catch (settingsErr) {
            normalizedSettings = normalizeExtractionSettings({});
        }

        console.log(`[extract-facts-file] Start for ${req.file.originalname}, size=${req.file.size} bytes`);

        const extracted = await extractTextFromUploadedFile(req.file);
        const afterExtractMs = Date.now() - startedAt;
        const extractedText = String(extracted?.text || '');
        imagesFromFile = Array.isArray(extracted?.images) ? extracted.images : [];

        normalizedText = extractedText.replace(/\s+/g, ' ').trim();
        console.log(`[extract-facts-file] Text extracted, length=${normalizedText.length}, images=${imagesFromFile.length}, elapsed=${afterExtractMs}ms`);

        if (!normalizedText) {
            return res.status(400).json({ error: 'No readable text found in the uploaded file.' });
        }
    } catch (err) {
        console.error('Error extracting text from file:', err.message);
        return res.status(400).json({ error: err.message });
    }

    try {
        const beforeFactsMs = Date.now();
        let llmFacts = [];
        if (normalizedSettings.fastMode) {
            llmFacts = refineFactsForCards(
                cleanFactCandidates(fallbackExtractFacts(normalizedText), normalizedText, normalizedSettings.maxFacts),
                normalizedText
            );
        } else {
            llmFacts = await extractFactsWithRetries(normalizedText);
        }
        const afterFactsMs = Date.now() - beforeFactsMs;
        console.log(`[extract-facts-file] Facts extraction done, facts=${llmFacts ? llmFacts.length : 0}, elapsed=${afterFactsMs}ms, total=${Date.now() - startedAt}ms`);

        const finalized = finalizeExtractionResult(llmFacts, normalizedText, normalizedSettings);

        if (llmFacts && llmFacts.length > 0) {
            return res.json({
                source: normalizedSettings.fastMode ? 'fallback-fast' : 'llm',
                fileName: req.file.originalname,
                chars: normalizedText.length,
                facts: finalized.facts,
                enrichedFacts: finalized.enrichedFacts,
                images: imagesFromFile,
                settings: finalized.settings
            });
        }

        const fallbackFacts = refineFactsForCards(
            cleanFactCandidates(fallbackExtractFacts(normalizedText), normalizedText, maxFacts),
            normalizedText
        );
        const finalizedFallback = finalizeExtractionResult(fallbackFacts, normalizedText, normalizedSettings);
        console.log(`[extract-facts-file] Using fallback facts, count=${fallbackFacts.length}, total=${Date.now() - startedAt}ms`);
        return res.json({
            source: 'fallback',
            fileName: req.file.originalname,
            chars: normalizedText.length,
            facts: finalizedFallback.facts,
            enrichedFacts: finalizedFallback.enrichedFacts,
            images: imagesFromFile,
            settings: finalizedFallback.settings,
            note: 'LLM returned no usable facts for this file. Fallback extraction used.'
        });
    } catch (err) {
        console.error('Error extracting facts from file via LLM:', err.message);
        const fallbackFacts = refineFactsForCards(
            cleanFactCandidates(fallbackExtractFacts(normalizedText), normalizedText, maxFacts),
            normalizedText
        );
        const finalizedFallback = finalizeExtractionResult(fallbackFacts, normalizedText, normalizedSettings);
        console.log(`[extract-facts-file] Error path, using fallback facts, count=${fallbackFacts.length}, total=${Date.now() - startedAt}ms`);
        return res.json({
            source: 'fallback',
            fileName: req.file.originalname,
            chars: normalizedText.length,
            facts: finalizedFallback.facts,
            enrichedFacts: finalizedFallback.enrichedFacts,
            images: imagesFromFile,
            settings: finalizedFallback.settings,
            note: 'LLM extraction failed (for example Ollama is not running). Fallback extraction used.'
        });
    }
});

app.post('/create-test-folder', (req, res) => {
    const fsSync = require('fs'); // Use the synchronous fs module
    const testFolderPath = path.join(__dirname, 'test-folder');
    const testFilePath = path.join(testFolderPath, 'test-file.txt');

    // Ensure the test folder exists
    if (!fsSync.existsSync(testFolderPath)) {
        fsSync.mkdirSync(testFolderPath);
    }

    fsSync.writeFile(testFilePath, 'This is a test file.', (err) => {
        if (err) {
            console.error('Error creating test file:', err);
            return res.status(500).json({ error: 'Error creating test file', details: err.message });
        }
        console.log('Test file created successfully');
        res.json({ message: 'Test file created successfully' });
    });
});

app.delete('/delete-card/:index', async (req, res) => {
    const cardsDir = path.join(__dirname, 'cards');

    try {
        const files = await fs.readdir(cardsDir);
        const cardFiles = files.filter(file => file.endsWith('.png'));
        const index = parseInt(req.params.index, 10);

        if (!Number.isInteger(index) || index < 0 || index >= cardFiles.length) {
            return res.status(404).json({ error: 'Card not found' });
        }

        const file = cardFiles[index];
        const imagePath = path.join(cardsDir, file);
        const metadataPath = path.join(cardsDir, `${file}.json`);

        await fs.unlink(imagePath);

        // Metadata may already be missing in some older cards; ignore that case.
        try {
            await fs.unlink(metadataPath);
        } catch (metadataErr) {
            if (metadataErr && metadataErr.code !== 'ENOENT') {
                throw metadataErr;
            }
        }

        return res.json({ message: 'Card deleted successfully' });
    } catch (err) {
        console.error('Error deleting card:', err);
        return res.status(500).json({ error: 'Error deleting card', details: err.message });
    }
});

app.delete('/delete-card-by-path', async (req, res) => {
    const cardsDir = path.join(__dirname, 'cards');
    const { imagePath } = req.body || {};

    if (!imagePath || typeof imagePath !== 'string') {
        return res.status(400).json({ error: 'imagePath is required' });
    }

    const fileName = path.basename(imagePath);
    if (!fileName || !fileName.endsWith('.png')) {
        return res.status(400).json({ error: 'Invalid imagePath' });
    }

    const imageFilePath = path.join(cardsDir, fileName);
    const metadataPath = path.join(cardsDir, `${fileName}.json`);

    try {
        await fs.unlink(imageFilePath);

        try {
            await fs.unlink(metadataPath);
        } catch (metadataErr) {
            if (metadataErr && metadataErr.code !== 'ENOENT') {
                throw metadataErr;
            }
        }

        return res.json({ message: 'Card deleted successfully' });
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            return res.status(404).json({ error: 'Card not found' });
        }
        console.error('Error deleting card by path:', err);
        return res.status(500).json({ error: 'Error deleting card', details: err.message });
    }
});

app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);

    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }

    if (err) {
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }

    next();
});

app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});
