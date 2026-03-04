declare module "ical-expander" {
  export interface ICalDateTime {
    toJSDate(): Date;
    isDate?: boolean;
  }

  export interface IcalEvent {
    startDate: ICalDateTime;
    endDate: ICalDateTime;
    summary?: string;
    description?: string;
    location?: string;
    isAllDay?: boolean;
  }

  export interface IcalOccurrence {
    startDate: ICalDateTime;
    endDate: ICalDateTime;
    item: IcalEvent;
  }

  export interface BetweenResult {
    events: IcalEvent[];
    occurrences: IcalOccurrence[];
  }

  export interface IcalExpanderOptions {
    ics?: string;
    url?: string;
    maxIterations?: number;
    maxEvents?: number;
  }

  export default class IcalExpander {
    constructor(options: IcalExpanderOptions);
    between(after: Date, before: Date): BetweenResult;
    before(date: Date): BetweenResult;
    after(date: Date): BetweenResult;
  }

  export { IcalExpander };
}
