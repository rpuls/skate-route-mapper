## Mobile (React Native) development guidlines
The mobile companion app is supposed to offer a simple, user friendly user experience. That allow user to easily; plan a route, view roughness on route, start new ride (with or without route planned), view simple stats about run.

Development should focus on a offline working application, so ride data collention is not interrupted when cell signal drops.

### Responsibilities
The mobile app only server the purpose of;
1. Connect with external sensors
2. Collecting ride data
3. Send raw ride + user data to backend
4. Uathenticating users
5. Display rides data
6. Simple route planning (outsourced to google api for now)

### Mobile app should not
1. Advanced algorithms
2. Process raw data
3. Advanced route planning

### Roadmap
TODO:
- user sign up (Waiting for datamodel)
- user authentication (Waiting for datamodel)
- sync users data from backend, when signing in (Waiting for datamodel)
- connect with n1 sensor via BLE collect data (Waiting for sensor to arrive)
- Ride statistics of finished rides; time, avg speed, max speed. 