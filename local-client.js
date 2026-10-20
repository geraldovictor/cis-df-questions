async function request(path, body) {
  try {
    const response = await fetch(`/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {'Content-Type':'application/json'},
      credentials:'same-origin',
      ...(body === undefined ? {} : {body:JSON.stringify(body)})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir.');
    return {data, error:null};
  } catch(error) { return {data:null,error}; }
}

export function createLocalClient() {
  let listener;
  async function authenticate(path, credentials) {
    const result = await request(path, credentials);
    if (!result.error) listener?.('SIGNED_IN', result.data.session);
    return result;
  }
  return {
    auth: {
      signUp: credentials => authenticate('signup', credentials),
      signInWithPassword: credentials => authenticate('login', credentials),
      async signOut() { return request('logout', {}); },
      async onAuthStateChange(callback) {
        listener = callback;
        const result = await request('session');
        if (result.error) { document.querySelector('#message').textContent = result.error.message; document.querySelector('#message').hidden = false; }
        callback('INITIAL_SESSION', result.data?.session || null);
      }
    },
    from(table) {
      return {
        upsert: row => request(table, row),
        select: () => ({order: () => request(table)})
      };
    }
  };
}
