// Must be imported before any functions/src module: Cloud Functions code uses
// Node's global Buffer, which browsers don't have.
import { Buffer } from 'buffer';

globalThis.Buffer = globalThis.Buffer || Buffer;
