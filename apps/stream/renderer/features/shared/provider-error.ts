export type StreamProvider = 'YouTube' | 'Zoom';

function errorText(error: unknown): string {
  if (typeof error === 'string') return error.trim();
  if (!error || typeof error !== 'object') return '';

  const value = error as { message?: unknown; statusMessage?: unknown };
  if (typeof value.message === 'string') return value.message.trim();
  if (typeof value.statusMessage === 'string') return value.statusMessage.trim();
  return '';
}

function unwrapIpcMessage(message: string): string {
  let result = message.split('\n', 1)[0]?.trim() ?? '';
  const wrapper = /^Error invoking remote method ['"].+?['"]:\s*/i;
  while (wrapper.test(result)) result = result.replace(wrapper, '');
  return result.replace(/^(?:Error|TypeError|DOMException):\s*/i, '').trim();
}

function safeMessage(provider: StreamProvider, rawMessage: string): string | null {
  const message = unwrapIpcMessage(rawMessage);
  if (!message) return null;
  const lower = message.toLowerCase();

  const canonicalMessages = [
    `Could not reach ${provider}. Check your internet connection and try again.`,
    `Secure credential storage is unavailable. Enable it on this device, then reconnect ${provider}.`,
    `${provider} sign-in is not available in this version of LumaStream. Contact your administrator to enable it.`,
    `${provider} sign-in was cancelled.`,
    `${provider} sign-in timed out. Try connecting again.`,
    `${provider} sign-in could not be verified. Try connecting again.`,
  ];
  if (provider === 'Zoom') {
    canonicalMessages.push(
      'Zoom could not verify this account for meeting access. Reconnect Zoom or ask your administrator to check account permissions.',
      'Zoom could not access the account or meeting. Reconnect Zoom; if the issue continues, ask your administrator to check the app permissions.',
      'This Zoom account is not eligible to stream live. Check its account plan and meeting permissions.',
      'Connect a Zoom account before starting output.',
      'Select a valid scheduled Zoom meeting, then try again.',
      'Enter a meeting topic between 1 and 200 characters.',
      'Choose a meeting start time in the future.',
      'Meeting duration must be between 1 and 1,440 minutes.',
      'Only the meeting host or a co-host can start Zoom output.',
      'Zoom sign-in expired. Reconnect the Zoom account, then try again.',
      'Choose Zoom output dimensions from 320×240 to 3840×2160, using even numbers.',
      'Zoom output could not start on this device. Check the selected meeting and permissions, then try again.',
      'Zoom returned an unexpected response. Try again, and contact support if the problem continues.',
      'Connect your Zoom account, then try again.',
      'Zoom sign-in did not complete. Try connecting again.',
      'Set the program canvas to match Zoom output dimensions.',
      'The selected Zoom audio track is unavailable. Choose another track and try again.',
      'Zoom output could not start. Check the selected meeting and output settings, then try again.',
    );
  } else {
    canonicalMessages.push(
      'YouTube denied access. Reconnect your account or check that the channel is eligible for live streaming.',
      'This YouTube channel is not enabled for live streaming. Check channel eligibility in YouTube Studio.',
      'This Google account has no YouTube channel. Connect an account with a channel.',
      'Connect a YouTube account before starting output.',
      'Enter a stream title between 1 and 100 characters.',
      'Shorten the stream description and try again.',
      'Choose a valid stream start time in the future.',
      'Select a scheduled YouTube stream, then try again.',
      'This YouTube stream has ended. Choose another stream.',
      'YouTube has not received video yet. Check the encoder connection, then try again.',
      'YouTube returned an unexpected response. Refresh the stream list and try again.',
    );
  }
  if (canonicalMessages.some((canonical) => lower === canonical.toLowerCase())) return message;

  if (/\b(?:network|fetch)\s+(?:is\s+)?unavailable\b|failed to fetch|fetch failed|networkerror|network request failed|internet connection|connection (?:was )?reset|econn(?:reset|refused|timedout)|etimedout|enotfound|eai_again/i.test(message)) {
    return `Could not reach ${provider}. Check your internet connection and try again.`;
  }

  if (/secure credential storage|os secure storage|encryption is unavailable/i.test(message)) {
    return `Secure credential storage is unavailable. Enable it on this device, then reconnect ${provider}.`;
  }

  const clientEnvironmentKey = provider === 'Zoom' ? 'LUMASTREAM_ZOOM_PUBLIC_CLIENT_ID' : 'LUMASTREAM_GOOGLE_CLIENT_ID';
  if (lower.includes(clientEnvironmentKey.toLowerCase()) || /account connection is not configured/i.test(message)) {
    return `${provider} sign-in is not available in this version of LumaStream. Contact your administrator to enable it.`;
  }

  if (/sign-in (?:was )?cancelled/i.test(message)) return `${provider} sign-in was cancelled.`;
  if (/sign-in timed out/i.test(message)) return `${provider} sign-in timed out. Try connecting again.`;
  if (/sign-in could not be verified|callback was invalid|invalid sign-in callback/i.test(message)) {
    return `${provider} sign-in could not be verified. Try connecting again.`;
  }

  if (provider === 'Zoom') {
    if (/does not return a zak|did not return a zak|user:read:zak/i.test(message)) {
      return 'Zoom could not verify this account for meeting access. Reconnect Zoom or ask your administrator to check account permissions.';
    }
    if (/denied access|denied this request|scope|account plan|meeting sdk app review/i.test(message)) {
      return 'Zoom could not access the account or meeting. Reconnect Zoom; if the issue continues, ask your administrator to check the app permissions.';
    }
    if (/live streaming is not enabled|live streaming eligibility/i.test(message)) {
      return 'This Zoom account is not eligible to stream live. Check its account plan and meeting permissions.';
    }
    if (/connect a zoom account first|connect a zoom account before/i.test(message)) return 'Connect a Zoom account before starting output.';
    if (/select a valid scheduled zoom meeting|meeting number is invalid|invalid zoom meeting/i.test(message)) {
      return 'Select a valid scheduled Zoom meeting, then try again.';
    }
    if (/enter a meeting (?:name|topic) between 1 and 200 characters/i.test(message)) return 'Enter a meeting topic between 1 and 200 characters.';
    if (/choose a meeting start time in the future/i.test(message)) return 'Choose a meeting start time in the future.';
    if (/meeting duration must be between 1 and 1,440 minutes/i.test(message)) return 'Meeting duration must be between 1 and 1,440 minutes.';
    if (/production studio requires the meeting host or co-host/i.test(message)) return 'Only the meeting host or a co-host can start Zoom output.';
    if (/meeting sdk authentication expired|identity expired|authentication expired/i.test(message)) {
      return 'Zoom sign-in expired. Reconnect the Zoom account, then try again.';
    }
    if (/between 320×240 and 3840×2160|between 320x240 and 3840x2160/i.test(message)) {
      return 'Choose Zoom output dimensions from 320×240 to 3840×2160, using even numbers.';
    }
    if (/supported on windows and macos only|not built or its runtime files are missing|native module unavailable|zoom sdk error|meeting sdk reported an error/i.test(message)) {
      return 'Zoom output could not start on this device. Check the selected meeting and permissions, then try again.';
    }
    if (/zoom returned an invalid response|zoom returned a meeting without an id|zoom (?:did not )?return a user id/i.test(message)) {
      return 'Zoom returned an unexpected response. Try again, and contact support if the problem continues.';
    }
    if (/did not return an authorization code|no authorization code was returned/i.test(message)) return 'Zoom sign-in did not complete. Try connecting again.';
    if (/account is not connected|connect zoom/i.test(message)) return 'Connect your Zoom account, then try again.';
    if (/canvas size must match zoom output size/i.test(message)) return 'Set the program canvas to match Zoom output dimensions.';
    if (/selected zoom audio track is not available/i.test(message)) return 'The selected Zoom audio track is unavailable. Choose another track and try again.';
    if (/video frames for zoom|zoom video output failed|zoom media could not start|zoom could not join|zoom meeting sdk/i.test(message)) {
      return 'Zoom output could not start. Check the selected meeting and output settings, then try again.';
    }
  } else {
    if (/denied access|live streaming eligibility|lives?treamingnotenabled/i.test(message)) {
      return 'YouTube denied access. Reconnect your account or check that the channel is eligible for live streaming.';
    }
    if (/this youtube channel is not enabled for live streaming/i.test(message)) {
      return 'This YouTube channel is not enabled for live streaming. Check channel eligibility in YouTube Studio.';
    }
    if (/connected google account has no youtube channel|no youtube channel/i.test(message)) {
      return 'This Google account has no YouTube channel. Connect an account with a channel.';
    }
    if (/connect a youtube account first|connect a youtube account/i.test(message)) return 'Connect a YouTube account before starting output.';
    if (/enter a stream title between 1 and 100 characters/i.test(message)) return 'Enter a stream title between 1 and 100 characters.';
    if (/stream description is too long/i.test(message)) return 'Shorten the stream description and try again.';
    if (/choose a valid stream start time in the future/i.test(message)) return 'Choose a valid stream start time in the future.';
    if (/select a valid youtube stream|selected youtube stream could not be found/i.test(message)) {
      return 'Select a scheduled YouTube stream, then try again.';
    }
    if (/youtube ended or revoked this stream|already ended/i.test(message)) return 'This YouTube stream has ended. Choose another stream.';
    if (/youtube did not detect an incoming video stream/i.test(message)) {
      return 'YouTube has not received video yet. Check the encoder connection, then try again.';
    }
    if (/youtube (?:did not finish|could not finish|ended|returned|request failed|service returned)/i.test(message)) {
      return 'YouTube returned an unexpected response. Refresh the stream list and try again.';
    }
  }

  return null;
}

/** Converts provider and Electron IPC failures into concise, actionable UI copy. */
export function providerErrorMessage(provider: StreamProvider, error: unknown, fallback: string): string {
  const message = errorText(error);
  return safeMessage(provider, message) ?? fallback;
}
