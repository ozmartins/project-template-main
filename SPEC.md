# [Feature Name] Specification

**Status:** Draft<!--[Draft | In Review | Approved | Implemented]-->
**Owner:** Oseias da Silva Martins
**Created:** 2026-06-24
**Last Updated:** 2026-06-24

## Overview

The goal of this functionality is to connect to a Gmail inbox and identify whether an email contains an attached PDF. If a PDF is found, it must be downloaded. It should be assumed that this PDF is an order for goods sold by my company. Next, the functionality must send the PDF to OpenAI's `structured-outputs` endpoint (I am unsure of the best approach for sending the PDF to OpenAI—e.g., converting it to base64, uploading it to a storage service, etc.). The expected result is JSON containing the properly structured order data.

## Goals

- Access the inbox of a specific Gmail account and retrieve messages that do not have the "imported" tag. Important: ignore any message that does not have a PDF attachment.
- Download the PDF of the messages found.
- Enviar o PDF para o endpoint structured-outputs da OpenAI solicitando que ele extraiai os dados do PDF e alimente um JSON com formato pre-determinado.
- Save the JSON to my database.

## Non-Goals

An order will contain customer data (name, address, etc.) and product data (SKU, description, quantity, price, and total). If the PDF found does not contain this information, it must be ignored.

## User Stories

### As a business owner, I want to streamline order entry in my ERP, reducing the manual labor required for data entry. 
### As a business owner, I want to streamline order entry in my ERP, making orders available to my shipping department more quickly.

**Acceptance Criteria:**
- [ ] The system must be able to connect to the inbox of a specific Gmail account.
- [ ] The system must be able to identify inbox messages that do not have the "imported" tag.
- [ ] The system needs to be able to identify whether the email has a PDF attached. If the email does not have a PDF attached, it must be ignored.
- [ ] The system must be able to send the PDF to the API.
- [ ] The system needs to be able to save the JSON returned by the OpenAI API to the database.
- [ ] The system needs to use the endpoint returned by OpenAI to perform a POST request to the orders endpoint.

## Technical Design

### Architecture

I want a simple architecture. Just a single layer—meaning a single C# project—but with the code organized into folders based on each class's responsibility.

### Data Model

Entities: Customers, Items (goods), Order and OrderLine.

### API Design
POST /customer
Request: {"firstName":"John","lastName":"Doe","email":"john.doe@example.com","phoneNumber":"+1-555-123-4567","documentNumber":"123456789","birthDate":"1990-05-15","address":{"street":"123 Main Street","number":"100","complement":"Apartment 5A","neighborhood":"Downtown","city":"Miami","state":"FL","postalCode":"33101","country":"USA"}}
Response: http=201; json={"success":true,"message":"Customer created successfully.","data":{"id":12345}}

PUT /customer/{id}
Request: {"firstName":"John","lastName":"Doe","email":"john.doe@example.com","phoneNumber":"+1-555-123-4567","documentNumber":"123456789","birthDate":"1990-05-15","address":{"street":"123 Main Street","number":"100","complement":"Apartment 5A","neighborhood":"Downtown","city":"Miami","state":"FL","postalCode":"33101","country":"USA"}}
Response: http=200; json={"success":true,"message":"Customer updated successfully.","data":{"id":12345}}

GET /customer/{id}
Response: http=200; json={"success":true,"data":{"id":12345,"firstName":"John","lastName":"Doe","email":"john.doe@example.com","phoneNumber":"+1-555-123-4567","documentNumber":"123456789","birthDate":"1990-05-15","address":{"street":"123 Main Street","number":"100","complement":"Apartment 5A","neighborhood":"Downtown","city":"Miami","state":"FL","postalCode":"33101","country":"USA"}}}

DELETE /customer/{id}
Response: http=200; json={"success":true,"message":"Customer deleted successfully."}

POST /item
Request: {"code":"PRD001","description":"Wireless Mouse","barcode":"7891234567890","unit":"EA","category":"Electronics","costPrice":25.50,"salePrice":49.90,"stockQuantity":100,"isActive":true}
Response: http=201; json={"success":true,"message":"Item created successfully.","data":{"id":67891}}

PUT /item/{id}
Request: {"code":"PRD001","description":"Wireless Mouse","barcode":"7891234567890","unit":"EA","category":"Electronics","costPrice":25.50,"salePrice":49.90,"stockQuantity":100,"isActive":true}
Response: http=200; json={"success":true,"message":"Item updated successfully.","data":{"id":67891}}

GET /item/{id}
Response: http=200; json={"success":true,"data":{"id":67891,"code":"PRD001","description":"Wireless Mouse","barcode":"7891234567890","unit":"EA","category":"Electronics","costPrice":25.50,"salePrice":49.90,"stockQuantity":100,"isActive":true}}

DELETE /item/{id}
Response: http=200; json={"success":true,"message":"Item deleted successfully."}

POST /order
Request: {"customerId":12345,"orderDate":"2026-06-24","paymentMethod":"CreditCard","items":[{"itemId":1001,"quantity":2,"unitPrice":49.90},{"itemId":1002,"quantity":1,"unitPrice":99.90}]}
Response: http=201; json={"success":true,"message":"Order created successfully.","data":{"id":67891}}

PUT /order/{id}
Request: {"customerId":12345,"orderDate":"2026-06-24","paymentMethod":"CreditCard","items":[{"itemId":1001,"quantity":2,"unitPrice":49.90},{"itemId":1002,"quantity":1,"unitPrice":99.90}]}
Response: http=200; json={"success":true,"message":"Order updated successfully.","data":{"id":67891}}

GET /order/{id}
Response: http=200; json={"success":true,"data":{"id":67891,"customerId":12345,"orderDate":"2026-06-24","paymentMethod":"CreditCard","items":[{"itemId":1001,"quantity":2,"unitPrice":49.90},{"itemId":1002,"quantity":1,"unitPrice":99.90}]}}

DELETE /order/{id}
Response: http=200; json={"success":true,"message":"Order deleted successfully."}

POST /imports/email-orders/start
Request: {"gmailAccount":"orders@company.com","maxMessages":50}
Response: {"success":true,"message":"Import started successfully.","data":{"importId":987}}

GET /imports/email-orders/{importId}
Response: {"success":true,"data":{"id":987,"status":"Processing","processedMessages":10,"createdOrders":7,"ignoredMessages":3}}

POST /emails/search-pending
Request: {"gmailAccount":"orders@company.com","maxMessages":20}
Response: {"success":true,"data":{"messages":[{"messageId":"abc123","subject":"Purchase Order #1001"}]}}

POST /emails/{messageId}/attachments/download
Response: {"success":true,"data":{"attachmentIds":["att001","att002"]}}

POST /documents/extract-order
Request: {"attachmentId":"att001"}
Response: {"success":true,"data":{"customer":{"name":"John Doe"},"items":[{"sku":"PRD001","quantity":2}]}}

POST /orders/import
Request: {"customer":{"name":"John Doe"},"items":[{"sku":"PRD001","quantity":2}]}
Response: {"success":true,"message":"Order imported successfully.","data":{"orderId":12345}}

POST /emails/{messageId}/mark-as-imported
Response: {"success":true,"message":"Email marked as imported."}

POST /emails/{messageId}/ignore
Request: {"reason":"PDF does not contain order information."}
Response: {"success":true,"message":"Email ignored successfully."}

GET /imports/email-orders/{importId}/errors
Response: {"success":true,"data":{"errors":[{"messageId":"abc123","error":"Customer not identified in PDF."}]}}

POST /imports/email-orders/{importId}/retry
Response: {"success":true,"message":"Import restarted successfully."}

### UI/UX Design

Follow React's visual patterns and a traditional ERP approach (lists and pages for data entry and editing). Use modals only to request confirmation for data deletion.

## Implementation Plan

### Phase 1: [Name]
- [ ] Conexão com a caixa de entrada de uma conta específica do Gmail.
- [ ] Search for inbox emails that do not have the "Imported" tag and have a PDF attached.
- [ ] Sending the PDF to the OpenAI API.
- [ ] Save the JSON returned by the OpenAI API to the database.
- [ ] Chamar o endpoint de pedidos para criar um pedido no sistema.

## Testing Strategy

- Unit tests
- Integration tests
- E2E tests
- Performance tests

## Rollout Plan

Deployment will be performed using our GitHub Actions CI/CD pipeline. The rollout strategy is a full release, meaning the feature will be made available to all users immediately after deployment.

## Metrics & Success Criteria

Success will be measured by the feature functioning as designed in production, without introducing regressions or operational issues. We will monitor error rates, system logs, and support requests related to the feature after deployment.

## Dependencies

- Supabase
- OpenAI API
