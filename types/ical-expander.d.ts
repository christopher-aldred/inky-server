declare module "ical-expander" {
  export interface ICalDateTime {
    toJSDate(): Date;
    isDate?: boolean;
    year?: number;
    month?: number;
    day?: number;
    hour?: number;
    minute?: number;
    second?: number;
    zone?: { tzid?: string };
  }

  export interface ICalComponent {
    getFirstPropertyValue?(name: string): unknown;
  }

  export interface IcalEvent {
    startDate: ICalDateTime;
    endDate: ICalDateTime;
    summary?: string;
    description?: string;
    location?: string;
    isAllDay?: boolean;
    component?: ICalComponent;
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
