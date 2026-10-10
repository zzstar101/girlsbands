/** One CDN's top-N over the window: key (path, country code, device kind) and requests. */
export type EdgeTop = Array<{ key: string; value: number }>;

/** What a single CDN counted: its own requests and bytes out per day, and its top-N lists. */
export interface CdnTraffic { daily:Array<{day:string;requests:number;fluxBytes:number}>; top:{urls:EdgeTop;countries:EdgeTop;devices:EdgeTop} }

export interface AdminStatsResponse {
  // Two CDNs serve the site now, so each keeps its own series: `gcore` is the pages, `edgeone` the static
  // files and images. Either is null while nothing has been counted for it (or its key is not configured).
  traffic: { daily: Array<{day:string;pv:number;uv:number}>; topItems:Array<{itemId:string;title:string;pv:number}>; topPaths:Array<{path:string;pv:number}>; referrers:Array<{host:string;pv:number}>; devices:Array<{device:string;pv:number}>; edge:CdnTraffic|null; gcore:CdnTraffic|null };
  content:{daily:Array<{day:string;collected:number;published:number;selected:number;blocked:number}>;byProject:Array<{entity:string;count:number}>;queue:{waiting:number;failed:number}};
  sources:{total:number;enabled:number;failing:Array<{id:string;name:string;lastError:string|null;lastSuccessAt:string|null}>;staleCount:number};
  models:{perMinutePeak:number;daily:Array<{day:string;calls:number;failed:number;rateLimited:number;tokensIn:number;tokensOut:number;cost:number}>;byPurpose:Array<{purpose:string;calls:number;avgLatencyMs:number}>;budget:{perMinute:number}};
  subscriptions:{subscribers:number;confirmed:number;daily:Array<{day:string;newSubs:number;unsubs:number}>;emails:{daily:Array<{day:string;sent:number;failed:number}>}};
  feedback:{open:number;total:number;daily:Array<{day:string;count:number}>};
}
