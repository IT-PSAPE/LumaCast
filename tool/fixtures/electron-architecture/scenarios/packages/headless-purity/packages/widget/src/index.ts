// Forbidden: a headless domain package must not import React.
import { useState } from 'react';

export function useWidget(): unknown {
  return useState;
}
