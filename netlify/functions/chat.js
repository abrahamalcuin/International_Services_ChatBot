const fs = require('fs');
const path = require('path');

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const ROOT_DIR = path.resolve(__dirname, '../../');
const KNOWLEDGE_DIR = path.join(ROOT_DIR, 'knowledge');
const SOURCES_PATH = path.join(KNOWLEDGE_DIR, 'sources.json');
const GUIDELINES_PATH = path.join(KNOWLEDGE_DIR, 'gemini-guidelines.md');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

let sourcesCache;
let guidelinesCache;
const docContentCache = new Map();

function loadSources() {
  if (sourcesCache) return sourcesCache;
  const raw = fs.readFileSync(SOURCES_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.documents)) {
    throw new Error('Invalid sources.json format.');
  }
  sourcesCache = parsed.documents.map((doc) => ({
    ...doc,
    id: doc.id || path.parse(doc.output || '').name,
  }));
  return sourcesCache;
}

function loadGuidelines() {
  if (guidelinesCache) return guidelinesCache;
  guidelinesCache = fs.readFileSync(GUIDELINES_PATH, 'utf-8').trim();
  return guidelinesCache;
}

function readDocContent(doc) {
  if (!doc?.output) return null;
  const absolute = path.resolve(ROOT_DIR, doc.output);
  if (docContentCache.has(absolute)) {
    return docContentCache.get(absolute);
  }
  if (!fs.existsSync(absolute)) {
    return null;
  }
  const content = fs.readFileSync(absolute, 'utf-8');
  docContentCache.set(absolute, content);
  return content;
}

function tokenize(text = '') {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((token) => token.length >= 4);
}

function scoreDocument(content, tokens) {
  if (!tokens.length) return 0;
  const haystack = content.toLowerCase();
  let score = 0;
  tokens.forEach((token) => {
    if (haystack.includes(token)) score += 1;
  });
  return score;
}

function truncateContent(content, limit = 900) {
  const words = content.split(/\s+/);
  if (words.length <= limit) return content;
  return `${words.slice(0, limit).join(' ')} ...`;
}

function selectKnowledge(category, question) {
  const docs = loadSources();
  const normalizedCategory = category ? category.toLowerCase() : '';
  const filtered = normalizedCategory
    ? docs.filter((doc) => (doc.category || '').toLowerCase() === normalizedCategory)
    : docs;

  const candidateDocs = filtered.length ? filtered : docs;
  const tokens = tokenize(question);

  const scored = candidateDocs
    .map((doc) => {
      const content = readDocContent(doc);
      if (!content) return null;
      return {
        ...doc,
        content,
        score: scoreDocument(content, tokens),
        primaryUrl: Array.isArray(doc.urls) && doc.urls.length ? doc.urls[0] : null,
      };
    })
    .filter(Boolean);

  if (!scored.length) {
    throw new Error('No knowledge documents available. Run the crawler to generate markdown files.');
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.title || '').localeCompare(b.title || '');
  });

  return scored.slice(0, 3);
}

function buildKnowledgeSnippet(documents) {
  const preface =
    'Use only the following knowledge. Cite sources with [Title](URL) and include the link explicitly.';
  const body = documents
    .map((doc, index) => {
      const text = truncateContent(doc.content);
      const url = doc.primaryUrl || 'https://www.byui.edu/international-services/';
      return [
        `Source ${index + 1}: ${doc.title || doc.output}`,
        `URL: ${url}`,
        text,
      ].join('\n');
    })
    .join('\n\n');
  return `${preface}\n\n${body}`;
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing GEMINI_API_KEY environment variable.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON payload.' }),
    };
  }

  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  const history = Array.isArray(payload.history) ? payload.history : [];
  const category = typeof payload.category === 'string' ? payload.category.trim() : '';

  if (!message) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Message is required.' }),
    };
  }

  let knowledgeDocs;
  try {
    knowledgeDocs = selectKnowledge(category, message);
  } catch (error) {
    console.error('Knowledge selection error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message || 'Knowledge selection failed.' }),
    };
  }

  const sanitizedHistory = history
    .slice(-10)
    .filter((entry) => entry && typeof entry.role === 'string' && typeof entry.content === 'string')
    .map((entry) => ({
      role: entry.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: entry.content }],
    }));

  const knowledgePart = {
    role: 'user',
    parts: [{ text: buildKnowledgeSnippet(knowledgeDocs) }],
  };

  const currentQuestionPart = {
    role: 'user',
    parts: [
      {
        text: [
          'You are helping an international student understand information.',
          `Here is their question: "${message}"`,
          'Follow these guidelines strictly:',
          loadGuidelines(),
          'This is their question again in case you need to restate it clearly.',
        ].join('\n\n'),
      },
    ],
  };

  const requestBody = {
    contents: [...sanitizedHistory, knowledgePart, currentQuestionPart],
  };

  try {
    const response = await fetch(`${API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', errorText);
      return {
        statusCode: response.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Gemini API request failed.' }),
      };
    }

    const data = await response.json();
    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text?.trim())
        .filter(Boolean)
        .join('\n\n') || "I couldn't generate a response right now, but I'm still here to help.";

    const sources = knowledgeDocs.map((doc) => ({
      title: doc.title,
      url: doc.primaryUrl,
      output: doc.output,
    }));

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply, sources }),
    };
  } catch (error) {
    console.error('Chat handler error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Unexpected server error.' }),
    };
  }
};
