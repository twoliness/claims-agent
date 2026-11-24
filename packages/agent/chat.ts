import '../../config/env';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadData } from './load';
import { createSession } from './tools';
import { createConversation, runAgentTurn } from './agent';
async function main() {
  const data = loadData(process.env.INSURER_CONFIG);
  const conversation = createConversation(createSession(data, new Intl.DateTimeFormat('en-CA', {timeZone: data.config.timezone}).format(new Date())));
  const terminal = createInterface({input: stdin, output: stdout});
  console.log(`${data.config.display_name} · fictional claims intake\nType /quit to leave. Sample identity: LM-1001 / 1991-04-12.\n`);
  try {
    while (true) {
      const text = (await terminal.question('You: ')).trim();
      if (text === '/quit') break;
      if (text) console.log(`\nAgent: ${await runAgentTurn(conversation, text)}\n`);
    }
  } finally { terminal.close(); }
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
