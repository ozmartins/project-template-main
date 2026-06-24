terraform {
  backend "azurerm" {
    resource_group_name  = "rg-selfheal-staging"
    storage_account_name = "stselfhealstgtf"
    container_name       = "tfstate"
    key                  = "10x-stack-dev.tfstate"
  }
}
