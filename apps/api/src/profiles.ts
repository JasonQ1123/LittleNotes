import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Response } from 'express';
import sharp from 'sharp';
import { Actor, CurrentUser, userSelect, withAvatar } from './auth';
import { Database } from './database';
import { UpdateProfileDto } from './dto';

const avatarLimit = 192 * 1024;
const avatarName = /^[a-f0-9]{32}\.webp$/;

@Injectable()
export class ProfilesService {
  readonly directory = resolve(
    process.env.AVATAR_STORAGE_DIR || join(__dirname, '..', 'uploads', 'avatars'),
  );
  constructor(private db: Database) {}

  async update(user: Actor, dto: UpdateProfileDto) {
    return withAvatar(
      await this.db.atomic((tx) =>
        tx.user.update({
          where: { id: user.id },
          data: { nickname: dto.nickname },
          select: userSelect,
        }),
      ),
    );
  }

  async upload(user: Actor, file?: Express.Multer.File) {
    if (!file?.buffer?.length || file.size > avatarLimit)
      throw new BadRequestException('请选择裁剪后的头像，大小不能超过 192 KB');
    let output: Buffer;
    try {
      const input = sharp(file.buffer, { limitInputPixels: 1024 * 1024, failOn: 'warning' });
      const metadata = await input.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) !== 1)
        throw new Error('Unsupported image');
      output = await input
        .rotate()
        .resize(256, 256, { fit: 'cover' })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      throw new BadRequestException('图片无法读取，请选择静态 JPG、PNG 或 WebP 图片');
    }
    const key = `${randomBytes(16).toString('hex')}.webp`;
    await mkdir(this.directory, { recursive: true, mode: 0o750 });
    const destination = join(this.directory, key);
    await writeFile(destination, output, { flag: 'wx', mode: 0o640 });
    try {
      const updated = await this.db.atomic((tx) =>
        tx.user.update({ where: { id: user.id }, data: { avatarKey: key }, select: userSelect }),
      );
      // Retain old files until the next complete database + avatar backup.
      return withAvatar(updated);
    } catch (error) {
      await unlink(destination).catch(() => undefined);
      throw error;
    }
  }

  async remove(user: Actor) {
    return withAvatar(
      await this.db.atomic((tx) =>
        tx.user.update({ where: { id: user.id }, data: { avatarKey: null }, select: userSelect }),
      ),
    );
  }

  async image(user: Actor, id: string) {
    const owner = await this.db.user.findFirst({
      where: {
        id,
        OR: [{ id: user.id }, ...(user.spaceId ? [{ spaceId: user.spaceId }] : [])],
      },
      select: { avatarKey: true },
    });
    if (!owner?.avatarKey || !avatarName.test(owner.avatarKey))
      throw new NotFoundException('头像不存在');
    try {
      return await readFile(join(this.directory, owner.avatarKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new NotFoundException('头像不存在');
      throw error;
    }
  }
}

@ApiTags('Profile')
@ApiCookieAuth()
@Controller('users')
export class ProfilesController {
  constructor(private service: ProfilesService) {}

  @Patch('me')
  update(@CurrentUser() user: Actor, @Body() dto: UpdateProfileDto) {
    return this.service.update(user, dto);
  }

  @Put('me/avatar')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: avatarLimit, files: 1, fields: 0, parts: 2, fieldNameSize: 32 },
    }),
  )
  upload(@CurrentUser() user: Actor, @UploadedFile() file?: Express.Multer.File) {
    return this.service.upload(user, file);
  }

  @Delete('me/avatar')
  remove(@CurrentUser() user: Actor) {
    return this.service.remove(user);
  }

  @Get(':id/avatar')
  async image(@CurrentUser() user: Actor, @Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.image(user, id);
    res.type('image/webp').set('Cache-Control', 'private, no-store').send(buffer);
  }
}
