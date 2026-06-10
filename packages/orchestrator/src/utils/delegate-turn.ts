export const DELEGATE_TURN_USER_MESSAGE = [
  '<delegate_turn>',
  'You are handling one agent.delegate task. Use tools as needed, then finish with final assistant text only.',
  'Do not call channel.post, channel.reply, channel.dm, message, channel.pass, channel.ack, or channel.handoff.',
  'Your final text is returned to the delegating agent as the tool result and ends this delegated turn.',
  '</delegate_turn>',
].join('\n');
