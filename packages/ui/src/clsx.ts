// Type-safe clsx implementation

export type ClassDictionary = Record<string, string | number | boolean | null | undefined>;
export type ClassValue =
    | string
    | number
    | boolean
    | null
    | undefined
    | ClassDictionary
    | ClassValue[];

function toVal(mix: ClassValue): string {
    let str = '';

    if (typeof mix === 'string' || typeof mix === 'number') {
        str += mix;
    } else if (typeof mix === 'object' && mix) {
        if (Array.isArray(mix)) {
            const len = mix.length;
            for (let k = 0; k < len; k++) {
                if (mix[k]) {
                    const y = toVal(mix[k]);
                    if (y) {
                        if (str) str += ' ';
                        str += y;
                    }
                }
            }
        } else {
            for (const key in mix as ClassDictionary) {
                if ((mix as ClassDictionary)[key]) {
                    if (str) str += ' ';
                    str += key;
                }
            }
        }
    }

    return str;
}

export function clsx(...args: ClassValue[]): string {
    let str = '';
    const len = args.length;
    for (let i = 0; i < len; i++) {
        const tmp = args[i];
        if (tmp) {
            const x = toVal(tmp);
            if (x) {
                if (str) str += ' ';
                str += x;
            }
        }
    }
    return str;
}

export default clsx;