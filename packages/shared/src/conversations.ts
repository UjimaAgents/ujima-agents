export function getDirectMessageThreadId(senderId: string, recipientId: string): string {
  const [firstId, secondId] = [senderId, recipientId].sort();
  return `dm:${firstId}:${secondId}`;
}
