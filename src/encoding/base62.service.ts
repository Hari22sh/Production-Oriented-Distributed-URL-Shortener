import { Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class Base62Service {
  private readonly chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  private readonly base = 62n;
  private readonly charMap: Map<string, bigint> = new Map();

  constructor() {
    for (let i = 0; i < this.chars.length; i++) {
      this.charMap.set(this.chars[i], BigInt(i));
    }
  }

  /**
   * Encodes a numeric ID (bigint or number) into a Base62 string.
   */
  public encode(num: bigint | number): string {
    let value = typeof num === 'number' ? BigInt(num) : num;

    if (value < 0n) {
      throw new BadRequestException('Cannot encode negative numbers');
    }

    if (value === 0n) {
      return this.chars[0];
    }

    let encoded = '';
    while (value > 0n) {
      const remainder = value % this.base;
      encoded = this.chars[Number(remainder)] + encoded;
      value = value / this.base;
    }

    return encoded;
  }

  /**
   * Decodes a Base62 string back into a numeric bigint ID.
   */
  public decode(str: string): bigint {
    if (!str || str.length === 0) {
      throw new BadRequestException('Short code cannot be empty');
    }

    let result = 0n;
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const val = this.charMap.get(char);
      if (val === undefined) {
        throw new BadRequestException(`Invalid Base62 character: '${char}'`);
      }
      result = result * this.base + val;
    }

    return result;
  }
}
