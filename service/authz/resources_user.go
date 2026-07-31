package authz

const (
	ResourceUserOperations = "user_operations"

	ActionAnalytics = "analytics"
	ActionExport    = "export"
	ActionBulk      = "bulk"
	ActionCampaign  = "campaign"
)

var (
	UserOperationsAnalytics = Permission{Resource: ResourceUserOperations, Action: ActionAnalytics}
	UserOperationsExport    = Permission{Resource: ResourceUserOperations, Action: ActionExport}
	UserOperationsBulk      = Permission{Resource: ResourceUserOperations, Action: ActionBulk}
	UserOperationsCampaign  = Permission{Resource: ResourceUserOperations, Action: ActionCampaign}
)

func init() {
	RegisterResource(ResourceDefinition{
		Resource: ResourceUserOperations,
		LabelKey: "User Operations",
		Actions: []ActionDefinition{
			{
				Action:         ActionAnalytics,
				LabelKey:       "View user analytics",
				DescriptionKey: "View growth, retention, revenue, and acquisition dashboards.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionExport,
				LabelKey:       "Export user data",
				DescriptionKey: "Download user directory exports containing contact details.",
			},
			{
				Action:         ActionBulk,
				LabelKey:       "Run bulk user actions",
				DescriptionKey: "Grant quota, change groups, and tag users in bulk.",
			},
			{
				Action:         ActionCampaign,
				LabelKey:       "Send campaigns",
				DescriptionKey: "Deliver email outreach to a saved segment.",
			},
		},
	})
}
