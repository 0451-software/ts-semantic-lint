/**
 * Fixture for `error-handling-completeness`.
 *
 * `loadUserSilently` has a catch block that swallows the failure and
 * returns null — the caller cannot tell whether the user doesn't exist
 * or whether the API request failed. The control `loadUserOrThrow`
 * propagates with context.
 */

export interface User {
  readonly id: string;
}

export async function loadUserSilently(id: string): Promise<User | null> {
  try {
    const response = await fetch(`/api/users/${id}`);
    return await response.json() as User;
  } catch {
    return null;
  }
}

export async function loadUserOrThrow(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) {
    throw new Error(`loadUser failed for ${id}: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<User>;
}
