import { Module } from "@nestjs/common";
import { DefaultUrlSafetyService } from "./default-url-safety.service";
import { URL_SAFETY_CHECKER } from "./url-safety.interface";

@Module({
  providers: [
    {
      provide: URL_SAFETY_CHECKER,
      useClass: DefaultUrlSafetyService,
    },
  ],
  exports: [URL_SAFETY_CHECKER],
})
export class SafetyModule {}
