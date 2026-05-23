import { describe, expect, it } from "vitest";
import { maskSensitiveData } from "./sensitive-data-mask";

describe("maskSensitiveData", () => {
  it("should mask Bearer tokens", () => {
    const input = `Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890abcdefg`;
    const output = maskSensitiveData(input);
    expect(output).toContain("TOKEN");
    expect(output).not.toContain(
      "Bearer abcdefghijklmnopqrstuvwxyz1234567890abcdefg",
    );
  });

  it("should handle input with no sensitive data", () => {
    const input = `const foo = "bar";`;
    const output = maskSensitiveData(input);
    expect(output).toBe(input);
  });

  it("should handle empty string input", () => {
    expect(maskSensitiveData("")).toBe("");
  });

  it("should not throw on malformed input", () => {
    expect(() => maskSensitiveData(null as unknown as string)).not.toThrow();
    expect(maskSensitiveData(null as unknown as string)).toBe("null");
  });

  it("should not double-mask already masked values", () => {
    const input = `password="****"`;
    const output = maskSensitiveData(input);
    expect(output).toBe(input);
  });

  it("should not mask variable names containing sensitive keywords", () => {
    const input = `
      const passwordLength = 12;
      let tokenCount = 5;
      function secretSauce() { return "delicious"; }
    `;
    const output = maskSensitiveData(input);
    expect(output).toContain("passwordLength = 12");
    expect(output).toContain("tokenCount = 5");
    expect(output).toContain("secretSauce");
    expect(output).toContain("delicious");
  });

  it("should not mask numbers or numeric assignments", () => {
    const input = `
      const num = 123456;
      let value = 42;
      var pi = 3.14159;
    `;
    const output = maskSensitiveData(input);
    expect(output).toContain("num = 123456");
    expect(output).toContain("value = 42");
    expect(output).toContain("pi = 3.14159");
  });

  it("should not mask code with similar but non-sensitive patterns", () => {
    const input = `
      const pass = "not_a_password";
      let tok = "not_a_token";
      var sec = "not_a_secret";
    `;
    const output = maskSensitiveData(input);
    expect(output).toContain('pass = "not_a_password"');
    expect(output).toContain('tok = "not_a_token"');
    expect(output).toContain('sec = "not_a_secret"');
  });

  it("should not mask comments containing sensitive keywords", () => {
    const input = `
      // password should be strong
      /* token is required */
      // secret sauce is the best
    `;
    const output = maskSensitiveData(input);
    expect(output).toContain("// password should be strong");
    expect(output).toContain("/* token is required */");
    expect(output).toContain("// secret sauce is the best");
  });

  it("should not mask object keys or property names with sensitive keywords", () => {
    const input = `
      const obj = {
        passwordHint: "use a strong one",
        tokenType: "Bearer",
        secretLevel: 5
      };
    `;
    const output = maskSensitiveData(input);
    expect(output).toContain('passwordHint: "use a strong one"');
    expect(output).toContain('tokenType: "Bearer"');
    expect(output).toContain("secretLevel: 5");
  });

  it("should not mask common Java code patterns", () => {
    const input = `
      public class User {
        private String username;
        private int age;
        public User(String username, int age) {
          this.username = username;
          this.age = age;
        }
        public String getUsername() { return username; }
        public int getAge() { return age; }
      }
    `;
    const output = maskSensitiveData(input);
    expect(output).toContain("public class User");
    expect(output).toContain("private String username;");
    expect(output).toContain("public int getAge()");
    expect(output).toContain("return username;");
  });

  it("should not mask Java code with method names containing sensitive keywords", () => {
    const input = `
      public String getPasswordHint() { return "hint"; }
      public String getTokenType() { return "Bearer"; }
      public int getSecretLevel() { return 1; }
    `;
    const output = maskSensitiveData(input);
    expect(output).toContain("getPasswordHint");
    expect(output).toContain("getTokenType");
    expect(output).toContain("getSecretLevel");
    expect(output).toContain('return "hint";');
  });

  it("should not mask common SQL code patterns", () => {
    const input = `
      SELECT id, username, email FROM users WHERE id = 1;
      UPDATE users SET email = 'new@example.com' WHERE id = 2;
      INSERT INTO users (username, email) VALUES ('foo', 'bar@example.com');
    `;
    const output = maskSensitiveData(input);
    expect(output).toContain("SELECT id, username, email FROM users");
    expect(output).toContain("UPDATE users SET email = 'new@example.com'");
    expect(output).toContain("INSERT INTO users (username, email)");
  });

  it("should not mask SQL code with column names containing sensitive keywords", () => {
    const input = `
      SELECT passwordHint, tokenType, secretLevel FROM user_secrets WHERE id = 1;
      UPDATE user_secrets SET passwordHint = 'hint' WHERE id = 2;
    `;
    const output = maskSensitiveData(input);
    expect(output).toContain(
      "SELECT passwordHint, tokenType, secretLevel FROM user_secrets",
    );
    expect(output).toContain("UPDATE user_secrets SET passwordHint = 'hint'");
  });
});
