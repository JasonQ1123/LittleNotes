import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export const CATEGORIES = [
  '沟通方式',
  '陪伴时间',
  '家务分工',
  '金钱消费',
  '边界隐私',
  '家庭朋友',
  '承诺计划',
  '其他',
];
export const RATINGS = ['明显改善', '部分改善', '没有改善', '变差', '暂时无法判断'];
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const IsOptional = () => ValidateIf((_object, value) => value !== undefined);

export class LoginDto {
  @ApiProperty()
  @trim()
  @IsString()
  @Matches(/^[a-zA-Z0-9_]{3,32}$/, { message: '用户名需为 3–32 位字母、数字或下划线' })
  username!: string;
  @ApiProperty()
  @IsString()
  @MinLength(8, { message: '密码至少需要 8 位' })
  @MaxLength(128)
  password!: string;
}
export class RegisterDto extends LoginDto {
  @ApiProperty() @trim() @IsString() @IsNotEmpty() @MaxLength(30) nickname!: string;
}
export class CreateSpaceDto {
  @ApiProperty() @trim() @IsString() @IsNotEmpty() @MaxLength(40) name!: string;
}
export class AcceptInvitationDto {
  @ApiProperty() @IsString() @Matches(/^[a-f0-9]{64}$/) token!: string;
}
export class CreateRecordDto {
  @ApiProperty()
  @trim()
  @IsString()
  @IsNotEmpty({ message: '先给这张纸条起个标题吧' })
  @MaxLength(100)
  title!: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() occurredAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) description?: string;
  @ApiPropertyOptional({ enum: CATEGORIES }) @IsOptional() @IsIn(CATEGORIES) category?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
}
export class UpdateRecordDto extends PartialType(CreateRecordDto, { skipNullProperties: false }) {
  @ApiProperty() @IsInt() @Min(1) revision!: number;
}
export class RecordsQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(CATEGORIES) category?: string;
  @IsOptional() @IsString() @MaxLength(30) tag?: string;
  @IsOptional() @IsIn(['draft', 'review', 'followup', 'archived']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page: number = 1;
}
export class PerspectiveDto {
  @ApiProperty() @IsInt() @Min(0) revision!: number;
  @ApiProperty() @IsBoolean() publish!: boolean;
  @ApiProperty() @IsString() @MaxLength(5000) facts!: string;
  @ApiProperty() @IsString() @MaxLength(5000) feelings!: string;
  @ApiProperty() @IsString() @MaxLength(5000) causes!: string;
  @ApiProperty() @IsString() @MaxLength(5000) needs!: string;
  @ApiProperty() @IsString() @MaxLength(5000) adjustments!: string;
}
export class ActionDto {
  @ApiProperty() @trim() @IsString() @IsNotEmpty() @MaxLength(1000) text!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) assigneeId!: string;
}
export class AgreementDto {
  @ApiProperty() @IsInt() @Min(0) baseVersion!: number;
  @ApiProperty() @trim() @IsString() @IsNotEmpty() @MaxLength(5000) understanding!: string;
  @ApiProperty({ type: [ActionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ActionDto)
  actions!: ActionDto[];
  @ApiProperty() @trim() @IsString() @IsNotEmpty() @MaxLength(3000) criteria!: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() dueAt?: string;
}
export class ReviewDto {
  @ApiProperty({ enum: RATINGS }) @IsIn(RATINGS) rating!: string;
  @ApiProperty() @IsIn(['已做到', '部分做到', '未做到', '暂不适用']) achieved!: string;
  @ApiProperty() @IsString() @MaxLength(5000) example!: string;
  @ApiProperty() @IsString() @MaxLength(5000) remaining!: string;
  @ApiProperty() @IsString() @MaxLength(5000) adjustments!: string;
}
export class DueDateDto {
  @ApiProperty() @IsISO8601() dueAt!: string;
}
export class ReconcileDto {
  @ApiProperty() @IsBoolean() value!: boolean;
}
export class LinkDto {
  @ApiProperty() @IsString() @MaxLength(100) relatedId!: string;
}
export class StatisticsQueryDto {
  @IsOptional() @Type(() => Number) @IsIn([30, 90, 365]) days: number = 90;
}
