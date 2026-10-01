import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class ClockMovedBackwardsException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClockMovedBackwardsException';
  }
}

@Injectable()
export class SnowflakeService implements OnModuleInit {
  private readonly logger = new Logger(SnowflakeService.name);

  // Custom Epoch: Jan 1, 2026 00:00:00 UTC (1767225600000 ms)
  private readonly epoch: bigint = 1767225600000n;

  private readonly workerIdBits: bigint = 10n;
  private readonly sequenceBits: bigint = 12n;

  private readonly maxWorkerId: bigint = -1n ^ (-1n << this.workerIdBits); // 1023
  private readonly maxSequence: bigint = -1n ^ (-1n << this.sequenceBits); // 4095

  private readonly workerIdShift: bigint = this.sequenceBits; // 12
  private readonly timestampShift: bigint = this.sequenceBits + this.workerIdBits; // 22

  private workerId: bigint = 1n;
  private sequence: bigint = 0n;
  private lastTimestamp: bigint = -1n;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const configuredWorkerId = this.configService.get<number>('workerId') ?? 1;
    this.setWorkerId(BigInt(configuredWorkerId));
  }

  public setWorkerId(workerId: bigint): void {
    if (workerId < 0n || workerId > this.maxWorkerId) {
      throw new Error(`Worker ID must be between 0 and ${this.maxWorkerId}`);
    }
    this.workerId = workerId;
    this.logger.log(`SnowflakeService initialized with Worker ID: ${this.workerId}`);
  }

  public getWorkerId(): bigint {
    return this.workerId;
  }

  /**
   * Synchronously generates a 64-bit unique Snowflake ID.
   * Thread/event-loop safe in JavaScript single-threaded event loop context.
   */
  public nextId(): bigint {
    let timestamp = this.timeGen();

    if (timestamp < this.lastTimestamp) {
      const offset = this.lastTimestamp - timestamp;
      if (offset <= 5n) {
        // Small backward drift, wait until clock catches up
        timestamp = this.tilNextMillis(this.lastTimestamp);
      } else {
        throw new ClockMovedBackwardsException(
          `Clock moved backwards by ${offset}ms. Refusing to generate ID.`
        );
      }
    }

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1n) & this.maxSequence;
      if (this.sequence === 0n) {
        // Sequence rollover in same millisecond, wait for next ms
        timestamp = this.tilNextMillis(this.lastTimestamp);
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTimestamp = timestamp;

    const id =
      ((timestamp - this.epoch) << this.timestampShift) |
      (this.workerId << this.workerIdShift) |
      this.sequence;

    return id;
  }

  private timeGen(): bigint {
    return BigInt(Date.now());
  }

  private tilNextMillis(lastTimestamp: bigint): bigint {
    let timestamp = this.timeGen();
    while (timestamp <= lastTimestamp) {
      timestamp = this.timeGen();
    }
    return timestamp;
  }
}
