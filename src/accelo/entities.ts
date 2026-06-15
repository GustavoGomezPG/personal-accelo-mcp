export interface IntFilterParam {
  /** zod input param name, e.g. "statusId" */
  param: string;
  /** GraphQL int filter enum key, e.g. "CompanyStatusId" */
  key: string;
  description: string;
}

export interface EntityConfig {
  /** plural key, used in tool names and as the connection root field */
  key: string;
  rootField: string;
  singular: string;
  /** int filter enum key used for get-by-id, e.g. "CompanyId" */
  idKey: string;
  /** text filter enum key used for free-text search, e.g. "CompanyName" */
  searchTextKey: string;
  /** human label for the searchable field, used in tool descriptions */
  searchLabel: string;
  defaultSort: { key: string; order: "ASC" | "DESC" };
  intFilters: IntFilterParam[];
  /** GraphQL selection set for a node (no surrounding braces) */
  selection: string;
}

const COMPANY_SELECTION = `
  id
  name
  phoneNumber
  website
  status { id title standing }
  accountManagers { id name { fullName } }
  activeProjectCount { count }
  activeTicketCount { count }
  primaryAddress { street1 street2 city postcode title }
  createdDate
  lastModifiedDate
`;

const CONTACT_SELECTION = `
  id
  name { fullName firstName surname }
  status { id title standing }
  primaryAffiliatedCompany { company { id name } position emailAddress phoneNumber }
  lastContactDate
`;

const PROJECT_SELECTION = `
  id
  title
  company { id name }
  manager { id name { fullName } }
  status { id title standing }
  standing
  budget { totalTime unallocatedTime }
  commencedDate
  completedDate
  createdDate
`;

const TICKET_SELECTION = `
  id
  title
  company { id name }
  assignee { id name { fullName } }
  status { id title standing }
  priority { id title }
  openedDate
  dueDate
  resolution { id title }
  resolutionNotes
`;

const TASK_SELECTION = `
  id
  title
  assignee { id name { fullName } }
  status { id title standing }
  priority { id title }
  project { id title }
  ticket { id title }
  milestone { id title }
  scheduledStartDate
  scheduledDueDate
  totalLoggedTime
  totalBudgetedTime
`;

export const ENTITIES: EntityConfig[] = [
  {
    key: "companies", rootField: "companies", singular: "company",
    idKey: "CompanyId", searchTextKey: "CompanyName", searchLabel: "company name",
    defaultSort: { key: "CompanyName", order: "ASC" },
    intFilters: [{ param: "statusId", key: "CompanyStatusId", description: "Filter by company status id" }],
    selection: COMPANY_SELECTION,
  },
  {
    key: "contacts", rootField: "contacts", singular: "contact",
    idKey: "ContactId", searchTextKey: "ContactName", searchLabel: "contact name",
    defaultSort: { key: "ContactSurname", order: "ASC" },
    intFilters: [
      { param: "companyId", key: "ContactCompanyId", description: "Filter by affiliated company id" },
      { param: "statusId", key: "ContactStatusId", description: "Filter by contact status id" },
    ],
    selection: CONTACT_SELECTION,
  },
  {
    key: "projects", rootField: "projects", singular: "project",
    idKey: "ProjectId", searchTextKey: "ProjectTitle", searchLabel: "project title",
    defaultSort: { key: "ProjectTitle", order: "ASC" },
    intFilters: [
      { param: "companyId", key: "ProjectCompanyId", description: "Filter by company id" },
      { param: "managerId", key: "ProjectManagerId", description: "Filter by manager staff id" },
      { param: "statusId", key: "ProjectStatusId", description: "Filter by project status id" },
    ],
    selection: PROJECT_SELECTION,
  },
  {
    key: "tickets", rootField: "tickets", singular: "ticket",
    idKey: "TicketId", searchTextKey: "TicketTitle", searchLabel: "ticket title",
    defaultSort: { key: "TicketOpenedDate", order: "DESC" },
    intFilters: [
      { param: "companyId", key: "TicketCompanyId", description: "Filter by company id" },
      { param: "assigneeId", key: "TicketAssigneeId", description: "Filter by assignee staff id" },
      { param: "statusId", key: "TicketStatusId", description: "Filter by ticket status id" },
    ],
    selection: TICKET_SELECTION,
  },
  {
    key: "tasks", rootField: "tasks", singular: "task",
    idKey: "TaskId", searchTextKey: "TaskTitle", searchLabel: "task title",
    defaultSort: { key: "TaskTitle", order: "ASC" },
    intFilters: [
      { param: "assigneeId", key: "TaskAssigneeId", description: "Filter by assignee staff id" },
      { param: "projectId", key: "TaskProjectId", description: "Filter by parent project id" },
      { param: "ticketId", key: "TaskTicketId", description: "Filter by parent ticket id" },
      { param: "statusId", key: "TaskStatusId", description: "Filter by task status id" },
    ],
    selection: TASK_SELECTION,
  },
];
