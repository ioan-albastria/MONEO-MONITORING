export class AuthUtils {
  static isTokenExpired(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp ? Date.now() / 1000 > payload.exp : false;
    } catch {
      return true;
    }
  }
}
