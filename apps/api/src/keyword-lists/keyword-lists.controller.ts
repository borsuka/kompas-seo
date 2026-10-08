import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  addListItemsSchema,
  clusterOptionsSchema,
  createKeywordListSchema,
  exportQuerySchema,
  listItemsQuerySchema,
  removeListItemsSchema,
  updateKeywordListSchema,
  updateListItemSchema,
  type KeywordListItem,
  type ListItemsQuery,
} from '@seo/shared';
import { KEYWORD_EXPORT_HEADERS, sendExport, type ExportColumn } from '../common/export.js';
import {
  CurrentOrg,
  CurrentUser,
  RequirePermission,
  type AppRequest,
  type AuthUser,
  type OrgContext,
} from '../common/request-context.js';
import type { ResearchContext } from '../keywords/keywords.service.js';
import { KeywordListsService } from './keyword-lists.service.js';

const id = z.string().min(1).max(64);
const exportSchema = exportQuerySchema.extend({ ui: z.enum(['bg', 'en']).default('bg') });

function itemColumns(ui: 'bg' | 'en'): ExportColumn<KeywordListItem>[] {
  const h = KEYWORD_EXPORT_HEADERS[ui];
  return [
    { header: h.keyword, value: (r) => r.keyword, width: 40 },
    { header: h.volume, value: (r) => r.volume },
    { header: h.kd, value: (r) => r.kd },
    { header: h.cpc, value: (r) => r.cpc },
    { header: h.competition, value: (r) => r.competition },
    { header: h.intent, value: (r) => r.intent.join(', '), width: 24 },
    { header: h.features, value: (r) => r.serpFeatures.join(', '), width: 30 },
    { header: h.words, value: (r) => r.wordCount },
    { header: h.cluster, value: (r) => r.cluster, width: 30 },
    { header: h.tags, value: (r) => r.tags.join(', '), width: 20 },
    { header: h.note, value: (r) => r.note, width: 40 },
  ];
}

@ApiTags('keyword-lists')
@Controller('keyword-lists')
export class KeywordListsController {
  constructor(private readonly lists: KeywordListsService) {}

  private ctx(org: OrgContext, user: AuthUser, req: AppRequest): ResearchContext {
    return {
      organizationId: org.id,
      userId: user.id,
      role: org.role,
      requestId: String(req.id ?? ''),
    };
  }

  @Get()
  @RequirePermission('keywordList:read')
  list(@CurrentOrg() org: OrgContext) {
    return this.lists.list(org.id);
  }

  @Post()
  @RequirePermission('keywordList:create')
  create(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Body({ schema: createKeywordListSchema }) body: z.output<typeof createKeywordListSchema>,
  ) {
    return this.lists.create(this.ctx(org, user, req), body);
  }

  @Get(':id')
  @RequirePermission('keywordList:read')
  get(@CurrentOrg() org: OrgContext, @Param('id', { schema: id }) listId: string) {
    return this.lists.get(org.id, listId);
  }

  @Patch(':id')
  @RequirePermission('keywordList:update')
  update(
    @CurrentOrg() org: OrgContext,
    @Param('id', { schema: id }) listId: string,
    @Body({ schema: updateKeywordListSchema }) body: z.output<typeof updateKeywordListSchema>,
  ) {
    return this.lists.update(org.id, listId, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('keywordList:delete')
  async remove(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) listId: string,
  ) {
    await this.lists.remove(this.ctx(org, user, req), listId);
  }

  @Get(':id/items')
  @RequirePermission('keywordList:read')
  items(
    @CurrentOrg() org: OrgContext,
    @Param('id', { schema: id }) listId: string,
    @Query({ schema: listItemsQuerySchema }) q: ListItemsQuery,
  ) {
    return this.lists.items(org.id, listId, q);
  }

  @Post(':id/items')
  @RequirePermission('keywordList:update')
  addItems(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) listId: string,
    @Body({ schema: addListItemsSchema }) body: z.output<typeof addListItemsSchema>,
  ) {
    return this.lists.addItems(this.ctx(org, user, req), listId, body);
  }

  @Patch(':id/items/:itemId')
  @HttpCode(204)
  @RequirePermission('keywordList:update')
  async updateItem(
    @CurrentOrg() org: OrgContext,
    @Param('id', { schema: id }) listId: string,
    @Param('itemId', { schema: id }) itemId: string,
    @Body({ schema: updateListItemSchema }) body: z.output<typeof updateListItemSchema>,
  ) {
    await this.lists.updateItem(org.id, listId, itemId, body);
  }

  /** Bulk removal (POST because DELETE bodies are poorly supported by proxies). */
  @Post(':id/items/remove')
  @RequirePermission('keywordList:update')
  removeItems(
    @CurrentOrg() org: OrgContext,
    @Param('id', { schema: id }) listId: string,
    @Body({ schema: removeListItemsSchema }) body: z.output<typeof removeListItemsSchema>,
  ) {
    return this.lists.removeItems(org.id, listId, body.ids);
  }

  @Get(':id/clusters')
  @RequirePermission('keywordList:read')
  clusters(@CurrentOrg() org: OrgContext, @Param('id', { schema: id }) listId: string) {
    return this.lists.clusters(org.id, listId);
  }

  /** Starts background clustering; follow progress via /jobs/:id/events. */
  @Post(':id/cluster')
  @RequirePermission('keywordList:update')
  cluster(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) listId: string,
    @Body({ schema: clusterOptionsSchema }) body: z.output<typeof clusterOptionsSchema>,
  ) {
    return this.lists.startClustering(this.ctx(org, user, req), listId, body.minSharedUrls);
  }

  @Get(':id/export')
  @RequirePermission('keywordList:read')
  async export(
    @CurrentOrg() org: OrgContext,
    @Param('id', { schema: id }) listId: string,
    @Query({ schema: exportSchema }) q: z.output<typeof exportSchema>,
    @Res() res: Response,
  ) {
    const { list, items } = await this.lists.exportItems(org.id, listId);
    await sendExport(res, q.format, list.name, itemColumns(q.ui), items);
  }
}
