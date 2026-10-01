import { Base62Service } from '../src/encoding/base62.service';
import { BadRequestException } from '@nestjs/common';

describe('Base62Service', () => {
  let service: Base62Service;

  beforeEach(() => {
    service = new Base62Service();
  });

  it('should correctly encode and decode 0', () => {
    const encoded = service.encode(0n);
    expect(encoded).toBe('0');
    expect(service.decode('0')).toBe(0n);
  });

  it('should encode and decode single digit boundary numbers', () => {
    expect(service.encode(1n)).toBe('1');
    expect(service.encode(61n)).toBe('z');

    expect(service.decode('1')).toBe(1n);
    expect(service.decode('z')).toBe(61n);
  });

  it('should encode 62 to "10"', () => {
    expect(service.encode(62n)).toBe('10');
    expect(service.decode('10')).toBe(62n);
  });

  it('should perform encode/decode roundtrips for medium & large numbers', () => {
    const testValues: bigint[] = [
      123456789n,
      9876543210123456789n,
      18446744073709551615n, // 64-bit unsigned max
      9223372036854775807n,  // 64-bit signed max
    ];

    for (const val of testValues) {
      const encoded = service.encode(val);
      expect(typeof encoded).toBe('string');
      expect(encoded.length).toBeGreaterThan(0);
      const decoded = service.decode(encoded);
      expect(decoded).toBe(val);
    }
  });

  it('should throw BadRequestException when decoding invalid characters', () => {
    expect(() => service.decode('abc!123')).toThrow(BadRequestException);
    expect(() => service.decode('hello space')).toThrow(BadRequestException);
  });

  it('should throw BadRequestException when decoding an empty string', () => {
    expect(() => service.decode('')).toThrow(BadRequestException);
  });

  it('should throw BadRequestException when encoding negative numbers', () => {
    expect(() => service.encode(-100n)).toThrow(BadRequestException);
  });
});
