// Local harness entrypoint only; production continues to use worker/index.ts.
import worker from './index';

export default {
  fetch(...args: Parameters<typeof worker.fetch>) {
    const [request, env] = args;
    const url = new URL(request.url);
    if (url.pathname === '/__local_ready') {
      const guard = (env as typeof env & { LOCAL_VERIFY_ID?: string }).LOCAL_VERIFY_ID;
      if (
        request.method !== 'GET' ||
        env.LOCAL_DEV !== 'true' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !guard ||
        request.headers.get('X-Local-Verify') !== guard
      )
        return new Response(null, { status: 403 });
      return Response.json({ ready: true });
    }
    return worker.fetch(...args);
  },
};
