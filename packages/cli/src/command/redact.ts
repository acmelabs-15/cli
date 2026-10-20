import type { World } from "./world";

/** What a removed secret reads as. */
const mark = "[redacted]";

/** An env variable's name that marks its value as a secret, in any letter case. */
const secretName = /TOKEN|SECRET|KEY|PASSWORD/iu;

/** The shortest env value that is removed. A shorter one, such as `1`, would blank unrelated text. */
const shortestSecret = 8;

/** The credentials in a URL: the text between `://` and the last `@` before the host. */
const urlCredentials = /(?<scheme>[a-z][\d+.a-z-]*:\/\/)[^\s/?#]+@/giu;

/**
 * A URL query parameter whose name holds a secret word, and its value. The value ends at the next
 * parameter, the fragment, a space, or a quote around the URL. A mark that ends a sentence or a
 * bracket after the URL, such as a period, stays.
 */
const secretParameter =
  /(?<name>[?&][^\s=&#]*(?:token|key|secret|password|signature|auth)[^\s=&#]*=)[^\s&#"'<>]*[^\s&#"'<>.,;:!?)]/giu;

/**
 * A bearer token after its scheme word, as an Authorization header holds it. A period after the
 * token stays, as it ends a sentence.
 */
const bearerToken = /(?<scheme>\bBearer\s+)[\w.~+/-]*[\w~+/-]=*/giu;

/**
 * The redaction for one world's env: a function that removes secrets from a text, each replaced
 * with `[redacted]`. A secret is the value of an env variable whose name holds TOKEN, SECRET, KEY
 * or PASSWORD, when the value has 8 characters or more; the credentials in a URL; the value of a
 * URL query parameter whose name holds token, key, secret, password, signature or auth; and the
 * value after `Bearer `.
 */
export function redactorFor(env: World["env"]): (text: string) => string {
  // The longest value first, so a value that holds a shorter one leaves no part of itself.
  const secrets = Object.entries(env)
    .flatMap(([name, value]) =>
      value !== undefined && value.length >= shortestSecret && secretName.test(name) ? [value] : [],
    )
    .toSorted((left, right) => right.length - left.length);
  return (text) => {
    let clean = text;
    for (const secret of secrets) {
      clean = clean.replaceAll(secret, mark);
    }
    return clean
      .replaceAll(urlCredentials, `$<scheme>${mark}@`)
      .replaceAll(secretParameter, `$<name>${mark}`)
      .replaceAll(bearerToken, `$<scheme>${mark}`);
  };
}
