test('username change is gated by the account PIN', async () => {
  // No PIN set yet: the change goes through without one.
  const first = await call('/users/me/username', {
    method: 'POST',
    token: aliceToken,
    body: { username: 'alice_renamed' },
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.user.username, 'alice_renamed');
  assert.ok(first.data.token, 'a fresh token is issued for the new username');

  // Set a PIN.
  const setPin = await call('/users/me/pin', {
    method: 'POST',
    token: aliceToken,
    body: { pin: '4321' },
  });
  assert.equal(setPin.status, 200);
  assert.equal(setPin.data.hasPin, true);

  // Omitting the PIN is refused, and says so.
  const missing = await call('/users/me/username', {
    method: 'POST',
    token: aliceToken,
    body: { username: 'alice_again' },
  });
  assert.equal(missing.status, 401);
  assert.match(missing.data.error, /required/i);

  // A WRONG PIN must be reported as wrong, not as missing — these are
  // different failures and the user needs to know which one happened.
  const wrong = await call('/users/me/username', {
    method: 'POST',
    token: aliceToken,
    body: { username: 'alice_again', pin: '0000' },
  });
  assert.equal(wrong.status, 401);
  assert.match(wrong.data.error, /incorrect/i);

  // The correct PIN works.
  const ok = await call('/users/me/username', {
    method: 'POST',
    token: aliceToken,
    body: { username: 'alice_again', pin: '4321' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.username, 'alice_again');

  // Put it back so later tests see the original handle.
  const back = await call('/users/me/username', {
    method: 'POST',
    token: aliceToken,
    body: { username: 'alice', pin: '4321' },
  });
  assert.equal(back.status, 200);
});
