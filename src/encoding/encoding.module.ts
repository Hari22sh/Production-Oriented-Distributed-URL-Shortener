import { Module } from '@nestjs/common';
import { Base62Service } from './base62.service';

@Module({
  providers: [Base62Service],
  exports: [Base62Service],
})
export class EncodingModule {}
