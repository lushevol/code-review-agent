export const chunkContent = (content: string, chunkSize: number) => {
  const changes = content;
  const chunks: string[] = [];
  if (changes.length > chunkSize) {
    // Split changes into chunks of MAX_TOKEN size
    for (let i = 0; i < changes.length; i += chunkSize) {
      const chunk = changes.slice(i, i + chunkSize);
      chunks.push(chunk);
    }
  } else {
    chunks.push(changes);
  }

  return chunks;
};
