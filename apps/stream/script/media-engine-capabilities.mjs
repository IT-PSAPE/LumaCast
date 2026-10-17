const REQUIRED_OUTPUT_PROTOCOLS = ['rist', 'srt'];

export function assertRequiredOutputProtocols(protocolsOutput) {
  const outputSection = protocolsOutput.match(/^Output:[ \t]*\r?\n([\s\S]*)$/m)?.[1];
  if (!outputSection) {
    throw new Error('The Stream media engine did not report its output protocols.');
  }

  const available = new Set(outputSection.split(/\r?\n/).map((line) => line.trim()));
  const missing = REQUIRED_OUTPUT_PROTOCOLS.filter((protocol) => !available.has(protocol));
  if (missing.length > 0) {
    throw new Error(`The Stream media engine is missing required output protocols: ${missing.join(', ')}.`);
  }
}
