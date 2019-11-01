# storage
modelized storage (localStorage/sessionStorage/cookie).

```js
const { storage } = require('@lakca/storage')

storage.define('profile', {
  name: {
    type: 'string'
  },
  gender: {
    type: 'boolean',
    default: true
  },
  introduction: {
    type: 'string',
    default: 'There is no introduction.'
  }
})

// localStorage
const result = storage('local', {
  namespace/* namespace, prevent from conflict */: 'test',
  saveDefault/* save default value to store or not */: false })
  .model('profile') /* choose model */
  .instance('mary'/* a primary key */, {
    name: 'mary'
  }) /* create or update mary instance */
  .property('gender', false) /* update property of previous instance. */
  .property({ gender: false }) /* update properties of previous instance. */
  .property('introduction') /* get property of previous instance. */
  .create('jack', {
    name: 'jack'
  }) /* create jack instance, throw error when jack already exists. */
  .instance('mary') /* choose instance mary */
  .property('name') /* return name property of previous instance */
  .end() /* execute, and return last execution result. mary instance will return here. */
```
