const { coverLetterMessages, tailorMessages, COVER_LETTER_SYSTEM, TAILOR_SYSTEM } = require('./prompts');

// Guards the CommonJS export shape: an `export default` here makes Node load the
// file as ESM, so these named requires come back undefined and every cover
// letter / tailoring request fails as a 503 "AI busy".
test('exports the prompt builders as CommonJS named exports', () => {
  expect(typeof coverLetterMessages).toBe('function');
  expect(typeof tailorMessages).toBe('function');
  expect(typeof COVER_LETTER_SYSTEM).toBe('string');
  expect(typeof TAILOR_SYSTEM).toBe('string');
});

test('coverLetterMessages puts the system prompt first and the inputs in the user message', () => {
  const msgs = coverLetterMessages({
    companyName: 'Acme Labs', position: 'Software Engineer', jd: 'Build the dashboard.', resumeText: 'Built React apps.',
  });
  expect(msgs[0]).toEqual({ role: 'system', content: COVER_LETTER_SYSTEM });
  const user = msgs[msgs.length - 1];
  expect(user.role).toBe('user');
  expect(user.content).toEqual(expect.stringContaining('Build the dashboard.'));
  expect(user.content).toEqual(expect.stringContaining('Built React apps.'));
});
