#!/usr/bin/env node
/**
 * Simple harness to execute the Netlify chat function locally against one or more prompts.
 *
 * Usage examples:
 *   node scripts/test_chat.js "What documents do I need for my I-20?" --category "new students"
 *   node scripts/test_chat.js --file scripts/test-prompts.json
 */
const fs = require('fs');
const path = require('path');

if (!process.env.GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY. Export it before running this test harness.');
  process.exit(1);
}

const { handler } = require('../netlify/functions/chat.js');

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = { category: '', file: null, messageTokens: [] };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--category' && i + 1 < args.length) {
      options.category = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--file' && i + 1 < args.length) {
      options.file = args[i + 1];
      i += 1;
      continue;
    }
    options.messageTokens.push(arg);
  }

  return options;
}

function loadTestCases({ file, messageTokens, category }) {
  if (file) {
    const absolute = path.resolve(process.cwd(), file);
    const raw = fs.readFileSync(absolute, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected array in ${file}`);
    }
    return parsed.map((item, index) => {
      if (!item?.message) {
        throw new Error(`Missing "message" in test case #${index + 1} from ${file}`);
      }
      return {
        message: item.message,
        category: item.category || category || '',
        history: Array.isArray(item.history) ? item.history : [],
      };
    });
  }

  const message = messageTokens.join(' ').trim();
  if (!message) {
    throw new Error('Provide a message or a --file with test cases.');
  }
  return [{ message, category, history: [] }];
}

async function runTestCase(testCase, index, total) {
  const label = `Test ${index + 1}/${total}`;
  console.log(`\n${label}: ${testCase.message}`);
  if (testCase.category) {
    console.log(`Category: ${testCase.category}`);
  }
  const start = Date.now();

  try {
    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({
        message: testCase.message,
        history: testCase.history,
        category: testCase.category,
      }),
    };

    const response = await handler(event, {});
    const elapsed = Date.now() - start;

    if (response.statusCode !== 200) {
      console.error(`Status ${response.statusCode}: ${response.body}`);
      return;
    }

    let payload;
    try {
      payload = JSON.parse(response.body);
    } catch (error) {
      console.error('Failed to parse JSON body:', error);
      console.error(response.body);
      return;
    }

    console.log(`Response (${elapsed} ms):\n${payload.reply || '<no reply>'}`);
    if (payload.sources?.length) {
      console.log('Source objects:', payload.sources);
    }
  } catch (error) {
    console.error('Test case failed:', error);
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv);
    const testCases = loadTestCases(options);
    for (let i = 0; i < testCases.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await runTestCase(testCases[i], i, testCases.length);
    }
  } catch (error) {
    console.error(error.message);
    console.error('\nUsage:');
    console.error('  node scripts/test_chat.js "your question here" [--category "new students"]');
    console.error('  node scripts/test_chat.js --file scripts/test-prompts.json');
    process.exit(1);
  }
}

main();
