import { defineModule } from '../../core/registry';

export default defineModule({
  name: 'sting',
  description: 'Sends a text message from src/dir/sting.js to a specified phone number',
  commands: ['sting'],
  async execute(context) {
    const { args, reply, sock } = context;

    // Check if a phone number was provided
    const targetNumber = args[0];
    if (!targetNumber) {
      return reply('❌ Please provide a phone number. Usage: `.sting +234XXXXXXXXXX`');
    }

    try {
      // Clean target number to format as WhatsApp JID
      const cleanNumber = targetNumber.replace(/[^0-9]/g, '');
      if (!cleanNumber) {
        return reply('❌ Invalid phone number format.');
      }
      const jid = `${cleanNumber}@s.whatsapp.net`;

      // Require the text message from src/dir/sting.js
      const stingPath = '../../dir/sting.js';
      delete require.cache[require.resolve(stingPath)]; // Clear require cache for live updates
      const stingModule = require(stingPath);
      const messageText = typeof stingModule === 'string' ? stingModule : (stingModule.message || 'Sting message empty');

      // Send the message via WhatsApp socket
      await sock.sendMessage(jid, { text: messageText });

      return reply(`✅ Successfully sent the sting message to ${targetNumber}`);
    } catch (error: any) {
      console.error('Error executing sting command:', error);
      return reply(`❌ Failed to send message: ${error.message || error}`);
    }
  },
});
