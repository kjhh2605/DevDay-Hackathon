// Only attached to the S3 default behavior. Unknown static files retain their 404.
export const spaRewriteCode = `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var path = uri.length > 1 && uri.slice(-1) === '/' ? uri.slice(0, -1) : uri;
  if (path === '/' || path === '/study' || /^\\/study\\/[^/.]+$/.test(path) ||
      path === '/experiences' || path === '/learning') {
    request.uri = '/index.html';
  }
  return request;
}`;
