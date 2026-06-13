const testCases = [
  {
    name: "Standard 6-digit code",
    body: "Your verification code is 123456. It will expire in 5 minutes.",
    expected: "123456"
  },
  {
    name: "Standard 5-digit code",
    body: "Verification code: 54321.",
    expected: "54321"
  },
  {
    name: "Standard 4-digit code",
    body: "Use 9876 to login.",
    expected: "9876"
  },
  {
    name: "Contains year (should not match year if there is another code, or should not match if it is just a year)",
    body: "Created in 2026. Your login code is 884732.",
    expected: "884732"
  },
  {
    name: "Long ID (should be ignored)",
    body: "Transaction ID: 987654321. Code: 1234.",
    expected: "1234"
  },
  {
    name: "Code with boundaries",
    body: "Code is: 12345",
    expected: "12345"
  }
];

function extractOtp(bodyContent: string): string | null {
  // Regex to find 4, 5, or 6-digit codes (e.g. 123456)
  // Matches boundaries to avoid matching years (like 2026) or long IDs
  // In the real api, we process from the beginning of the string, but we want to make sure it matches the actual code.
  // Wait, in real api, if bodyContent contains both "2026" and a 6 digit code, it might match the first one if the regex isn't careful.
  // Let's test the exact behavior.
  
  // Note: in src/api/outlook.ts, it uses: bodyContent.match(/\b(\d{4,6})\b/)
  // Let's check what it matches.
  const match = bodyContent.match(/\b(?!19\d{2}\b|20\d{2}\b)(\d{4,6})\b/);
  return match ? match[1] : null;
}

console.log("=== Testing OTP Extraction Regex ===");
let passed = 0;
for (const tc of testCases) {
  const result = extractOtp(tc.body);
  const ok = result === tc.expected;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${tc.name}`);
  console.log(`  Body: "${tc.body}"`);
  console.log(`  Expected: ${tc.expected}, Got: ${result}`);
  if (ok) passed++;
}

console.log(`\nResult: ${passed}/${testCases.length} passed.`);
