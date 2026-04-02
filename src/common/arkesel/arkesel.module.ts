import { Module } from '@nestjs/common';
import { ArkeselService } from './arkesel.service';

@Module({
    providers: [ArkeselService],
    exports: [ArkeselService],
})
export class ArkeselModule { }
