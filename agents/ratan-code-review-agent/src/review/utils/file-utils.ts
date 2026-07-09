export const extractFileExtension = (fileName: string) => {
  return fileName.split(".").pop()?.toLowerCase();
};
