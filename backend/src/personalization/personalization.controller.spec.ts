import { Test, TestingModule } from '@nestjs/testing';
import { PersonalizationController } from './personalization.controller';
import { PersonalizationService } from './personalization.service';

describe('PersonalizationController', () => {
  let controller: PersonalizationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PersonalizationController],
      providers: [PersonalizationService],
    }).compile();

    controller = module.get<PersonalizationController>(PersonalizationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
