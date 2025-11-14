const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

  if (!message) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Message is required.' }),
    };
  }

  const sanitizedHistory = history
    .slice(-10)
    .filter((entry) => entry && typeof entry.role === 'string' && typeof entry.content === 'string')
    .map((entry) => ({
      role: entry.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: entry.content }],
    }));

  const contents = [
    ...sanitizedHistory,
    {
      role: 'user',
      parts: [{ text: message }],
    },
  ];

  const requestBody = {
    contents,
    systemInstruction: {
      role: 'user',
      parts: [
        {
          text: [
            'You are the International Services virtual assistant for Alcuin Abraham.',
            'Only answer questions using information that would be present in the official international services knowledge base.',
            'If you are unsure, clearly state that you need to confirm the answer.',
            'Keep responses concise, structured, and friendly. Offer to capture follow-up actions when it makes sense.',
          ].join(' '),
        },
      ],
    },
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

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply }),
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
