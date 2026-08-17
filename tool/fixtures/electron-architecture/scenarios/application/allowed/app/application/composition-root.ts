// app/application is the composition root (issue #223): it may import any
// zone and any package.
import { coreThing } from '../core/thing';
import { databaseThing } from '../database/thing';
import { mainThing } from '../main/thing';
import { widgetThing } from '@lumacast/widget';

export function composeApp(): number {
  return coreThing + databaseThing + mainThing + widgetThing;
}
