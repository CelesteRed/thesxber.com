// Static fallback used while the API is unavailable. The server discovers the
// same files dynamically, so new Discord uploads do not need a frontend build.
export const staticFanart = [
  1, 2, 3, 4, 5, 6, 7, 8, 9,
  10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
  36, 37, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49
].map((index) => {
  const extension = (index >= 16 && index <= 35) || index >= 42 ? "png" : "jpg";
  return {
    id: index,
    filename: `fanart${index}.${extension}`,
    url: `/fanart/fanart${index}.${extension}`,
    title: `Fanart ${index}`
  };
});
